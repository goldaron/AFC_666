from flask import Flask, Blueprint, request, jsonify
from decimal import Decimal
from typing import List, Optional

from utils import get_connection
from game_session import GameSession
from airplane import init_airplanes
from session_helpers import (
    fetch_player_aircrafts_with_model_info,
    get_current_aircraft_upgrade_state,
    calc_aircraft_upgrade_cost,
    apply_aircraft_upgrade,
    get_effective_eco_for_aircraft,
    fetch_owned_bases,
    fetch_base_current_level_map,
    insert_base_upgrade,
)
from upgrade_config import REPAIR_COST_PER_PERCENT

api_bp = Blueprint("api", __name__)


def _require_save_id():
    sid = request.args.get("save_id")
    if not sid:
        return None, (jsonify({"error": "missing save_id (use ?save_id=...)"}), 400)
    try:
        return int(sid), None
    except Exception:
        return None, (jsonify({"error": "invalid save_id"}), 400)


def _dec_to_str(v: Optional[Decimal]):
    if v is None:
        return None
    if not isinstance(v, Decimal):
        v = Decimal(str(v))
    return str(v.quantize(Decimal("0.01")))


@api_bp.route("/api/aircrafts", methods=["GET"])
def list_aircrafts():
    save_id, err = _require_save_id()
    if err:
        return err
    rows = fetch_player_aircrafts_with_model_info(save_id) or []
    sess = GameSession.load(save_id)
    ids = [int(r["aircraft_id"]) for r in rows]
    upgrade_map = sess._fetch_upgrade_levels(ids) if ids else {}
    out = []
    for r in rows:
        aid = int(r["aircraft_id"])
        eff = None
        try:
            eff_val = get_effective_eco_for_aircraft(aid)
            eff = Decimal(str(eff_val))
        except Exception:
            eff = None
        out.append({
            "aircraft_id": aid,
            "registration": r.get("registration"),
            "model_code": r.get("model_code"),
            "model_name": r.get("model_name"),
            "current_airport_ident": r.get("current_airport_ident"),
            "purchase_price": _dec_to_str(Decimal(str(r.get("purchase_price") or "0"))),
            "condition_percent": int(r.get("condition_percent") or 0),
            "hours_flown": int(r.get("hours_flown") or 0),
            "status": r.get("status"),
            "acquired_day": int(r.get("acquired_day") or 0),
            "eco_level": int(upgrade_map.get(aid, 0)),
            "effective_eco": _dec_to_str(eff) if eff is not None else None,
        })
    return jsonify({"save_id": save_id, "aircraft": out})


@api_bp.route("/api/aircrafts/<int:aircraft_id>", methods=["GET"])
def get_aircraft(aircraft_id: int):
    save_id, err = _require_save_id()
    if err:
        return err
    rows = fetch_player_aircrafts_with_model_info(save_id) or []
    row = next((r for r in rows if int(r["aircraft_id"]) == aircraft_id), None)
    if not row:
        return jsonify({"error": "aircraft not found"}), 404
    state = get_current_aircraft_upgrade_state(aircraft_id) or {"level": 0}
    cur_level = int(state.get("level") or 0)
    next_level = cur_level + 1
    next_cost = None
    try:
        next_cost = calc_aircraft_upgrade_cost(row, next_level)
    except Exception:
        next_cost = None
    # effective eco current
    try:
        cur_eff = Decimal(str(get_effective_eco_for_aircraft(aircraft_id)))
    except Exception:
        cur_eff = None
    # conservative next estimate: multiply by 1.05 if unknown
    next_eff = None
    try:
        if cur_eff is not None:
            next_eff = (cur_eff * Decimal("1.05")).quantize(Decimal("0.01"))
    except Exception:
        next_eff = None
    return jsonify({
        "aircraft_id": aircraft_id,
        "registration": row.get("registration"),
        "model_code": row.get("model_code"),
        "model_name": row.get("model_name"),
        "current_airport_ident": row.get("current_airport_ident"),
        "condition_percent": int(row.get("condition_percent") or 0),
        "hours_flown": int(row.get("hours_flown") or 0),
        "status": row.get("status"),
        "acquired_day": int(row.get("acquired_day") or 0),
        "eco": {
            "current_level": cur_level,
            "next_level": next_level,
            "current_effective_eco": _dec_to_str(cur_eff) if cur_eff is not None else None,
            "next_effective_eco_estimate": _dec_to_str(next_eff) if next_eff is not None else None,
            "next_upgrade_cost": _dec_to_str(next_cost) if next_cost is not None else None,
        }
    })


@api_bp.route("/api/aircrafts/<int:aircraft_id>/repair", methods=["POST"])
def repair_aircraft(aircraft_id: int):
    save_id, err = _require_save_id()
    if err:
        return err
    sess = GameSession.load(save_id)
    # estimate cost
    conn = get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT condition_percent FROM aircraft WHERE aircraft_id = %s AND save_id = %s",
                    (aircraft_id, save_id))
        r = cur.fetchone()
        if not r:
            return jsonify({"error": "aircraft not found"}), 404
        cond = int(r.get("condition_percent") or 0)
        missing = max(0, 100 - cond)
        est_cost = (Decimal(missing) * REPAIR_COST_PER_PERCENT).quantize(Decimal("0.01"))
    finally:
        try:
            cur.close()
        except Exception:
            pass
        conn.close()
    ok = sess._repair_aircraft_to_full_tx(aircraft_id)
    if not ok:
        return jsonify({"status": "error", "message": "repair failed (insufficient funds / busy / other)"}), 409
    return jsonify({
        "status": "ok",
        "aircraft_id": aircraft_id,
        "cost_charged": _dec_to_str(est_cost),
        "remaining_cash": _dec_to_str(sess.cash),
    })


@api_bp.route("/api/aircrafts/<int:aircraft_id>/upgrade", methods=["POST"])
def upgrade_aircraft(aircraft_id: int):
    save_id, err = _require_save_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    if not data.get("confirm"):
        return jsonify({"error": "confirm required"}), 400
    sess = GameSession.load(save_id)
    rows = fetch_player_aircrafts_with_model_info(save_id) or []
    row = next((r for r in rows if int(r["aircraft_id"]) == aircraft_id), None)
    if not row:
        return jsonify({"error": "aircraft not found"}), 404
    state = get_current_aircraft_upgrade_state(aircraft_id) or {"level": 0}
    cur_level = int(state.get("level") or 0)
    next_level = cur_level + 1
    try:
        cost = calc_aircraft_upgrade_cost(row, next_level)
    except Exception as e:
        return jsonify({"error": "cost_calculation_failed", "detail": str(e)}), 500
    if _to_dec := None:  # placeholder to keep lint happy
        pass
    if sess.cash < Decimal(str(cost)):
        return jsonify({"error": "insufficient_funds"}), 402
    try:
        apply_aircraft_upgrade(aircraft_id=aircraft_id, installed_day=sess.current_day)
        sess._add_cash(-Decimal(str(cost)), context="AIRCRAFT_ECO_UPGRADE")
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({
        "status": "ok",
        "aircraft_id": aircraft_id,
        "new_level": next_level,
        "cost": _dec_to_str(cost),
        "remaining_cash": _dec_to_str(sess.cash),
    })


@api_bp.route("/api/bases", methods=["GET"])
def list_bases():
    save_id, err = _require_save_id()
    if err:
        return err
    bases = fetch_owned_bases(save_id) or []
    base_ids = [int(b["base_id"]) for b in bases]
    level_map = fetch_base_current_level_map(base_ids) if base_ids else {}
    out = []
    for b in bases:
        out.append({
            "base_id": int(b["base_id"]),
            "base_ident": b.get("base_ident"),
            "base_name": b.get("base_name"),
            "acquired_day": int(b.get("acquired_day") or 0),
            "purchase_cost": _dec_to_str(Decimal(str(b.get("purchase_cost") or "0"))),
            "current_level": level_map.get(int(b["base_id"]), "SMALL"),
        })
    return jsonify({"owned_bases": out})


@api_bp.route("/api/bases/<int:base_id>/upgrade", methods=["POST"])
def upgrade_base(base_id: int):
    save_id, err = _require_save_id()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    if not data.get("confirm"):
        return jsonify({"error": "confirm required"}), 400
    sess = GameSession.load(save_id)
    bases = fetch_owned_bases(save_id) or []
    b = next((x for x in bases if int(x["base_id"]) == base_id), None)
    if not b:
        return jsonify({"error": "base not owned"}), 404
    lvl_map = fetch_base_current_level_map([base_id]) or {}
    current = lvl_map.get(base_id, "SMALL")
    BASE_LEVELS = ["SMALL", "MEDIUM", "LARGE", "HUGE"]
    BASE_UPGRADE_COST_PCTS = {
        ("SMALL", "MEDIUM"): Decimal("0.50"),
        ("MEDIUM", "LARGE"): Decimal("0.90"),
        ("LARGE", "HUGE"): Decimal("1.50"),
    }
    try:
        cur_idx = BASE_LEVELS.index(current)
    except ValueError:
        cur_idx = 0
    if cur_idx >= len(BASE_LEVELS) - 1:
        return jsonify({"error": "already_max"}), 400
    nxt = BASE_LEVELS[cur_idx + 1]
    pct = BASE_UPGRADE_COST_PCTS[(current, nxt)]
    cost = (Decimal(str(b.get("purchase_cost") or "0")) * pct).quantize(Decimal("0.01"))
    if sess.cash < cost:
        return jsonify({"error": "insufficient_funds"}), 402
    try:
        insert_base_upgrade(base_id, nxt, cost, sess.current_day)
        sess._add_cash(-cost, context="BASE_UPGRADE")
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({
        "status": "ok",
        "base_id": base_id,
        "from": current,
        "to": nxt,
        "cost": _dec_to_str(cost),
        "remaining_cash": _dec_to_str(sess.cash),
    })


def create_app():
    app = Flask(__name__)
    app.register_blueprint(api_bp)
    return app

if __name__ == "__main__":
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=True)