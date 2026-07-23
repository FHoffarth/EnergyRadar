"""EnergyRadar – Flask-App.

Orchestriert Collector, Decision Engine und Storage. Keine eigene Fachlogik.
"""

from datetime import datetime

from flask import Flask, jsonify, render_template, request, send_from_directory

from energyradar import config
from energyradar.collectors import fronius
from energyradar.services import data_source, decision, storage

import os
import sys

app = Flask(__name__)



def _seed_demo_history() -> None:
    """Im Demo-Modus einmalig eine Tageskurve anlegen,
    damit Diagramm und Peak sofort sichtbar sind."""
    if config.DEMO and not storage.has_data_for_today():
        storage.save_many(fronius.demo_history(datetime.now()))


@app.route("/api/live")
def live():
    if not config.DEMO and data_source.effective() is None:
        return jsonify({
            "ok": False,
            "status": "no_data_source_configured",
            "configured": False,
        })

    try:
        reading = fronius.read_demo() if config.DEMO else fronius.read()
    except Exception:
        return jsonify({
            "ok": False,
            "status": "device_temporarily_unreachable",
            "configured": True,
        }), 503

    storage.save(reading)

    level, text = decision.recommend(reading.power)
    peak = storage.peak_today()

    return jsonify({
        "ok": True,
        "status": "connected",
        "configured": True,
        "source": "demo" if config.DEMO else "live",
        "power": round(reading.power),
        "today_kwh": round(reading.energy_today / 1000, 2),
        "year_kwh": round(reading.energy_year / 1000),
        "total_kwh": round(reading.energy_total / 1000),
        "level": level,
        "recommendation": text,
        "peak_today": round(peak[0]) if peak else None,
        "peak_time": peak[1] if peak else None,
        "history": storage.history_today(),
    })


def _address_from_request() -> str:
    payload = request.get_json(silent=True) or {}
    if payload.get("provider", "fronius") != "fronius":
        raise data_source.DataSourceError("Only the Fronius provider is supported.")
    value = payload.get("address")
    if not isinstance(value, str):
        raise data_source.DataSourceError("Enter a local IP address or .local hostname.")
    return value


@app.get("/api/data-source")
def get_data_source():
    selected = data_source.effective()
    if selected is None:
        return jsonify({
            "ok": True,
            "configured": False,
            "status": "no_data_source_configured",
            "provider": "fronius",
        })

    return jsonify({
        "ok": True,
        "configured": True,
        "status": "connected",
        "provider": "fronius",
        "source": selected["source"],
        "address": (
            data_source.display_address(selected["url"])
            if selected["source"] == "saved"
            else None
        ),
        "editable": selected["source"] == "saved",
    })


@app.post("/api/data-source/test")
def test_data_source():
    try:
        normalized = data_source.normalize_address(_address_from_request())
        fronius.read_url(normalized, require_local=True)
    except data_source.UnsafeTargetError:
        return jsonify({
            "ok": False,
            "status": "connection_failed",
            "message": "unsafe_target",
        }), 400
    except data_source.DataSourceError:
        return jsonify({
            "ok": False,
            "status": "connection_failed",
            "message": "invalid_address",
        }), 400
    except Exception:
        return jsonify({
            "ok": False,
            "status": "connection_failed",
            "message": "device_unreachable",
        }), 503

    return jsonify({
        "ok": True,
        "status": "connected",
        "provider": "fronius",
        "address": data_source.display_address(normalized),
    })


@app.post("/api/data-source")
def save_data_source():
    if config.FRONIUS_URL:
        return jsonify({
            "ok": False,
            "status": "connection_failed",
            "message": "environment_override_active",
        }), 409
    try:
        normalized = data_source.normalize_address(_address_from_request())
        fronius.read_url(normalized, require_local=True)
        selected = data_source.save(normalized)
    except data_source.UnsafeTargetError:
        return jsonify({
            "ok": False,
            "status": "connection_failed",
            "message": "unsafe_target",
        }), 400
    except data_source.DataSourceError:
        return jsonify({
            "ok": False,
            "status": "connection_failed",
            "message": "invalid_address",
        }), 400
    except Exception:
        return jsonify({
            "ok": False,
            "status": "connection_failed",
            "message": "device_unreachable",
        }), 503

    return jsonify({
        "ok": True,
        "configured": True,
        "status": "connected",
        "provider": "fronius",
        "source": selected["source"],
        "address": data_source.display_address(selected["url"]),
        "editable": True,
    })


@app.delete("/api/data-source")
def delete_data_source():
    if config.FRONIUS_URL:
        return jsonify({
            "ok": False,
            "status": "connected",
            "message": "environment_override_active",
        }), 409
    data_source.remove_saved()
    return jsonify({
        "ok": True,
        "configured": False,
        "status": "no_data_source_configured",
        "provider": "fronius",
    })


@app.route("/sw.js")
def service_worker():
    """Service Worker muss unter / liegen, damit sein Scope die ganze App umfasst."""
    return send_from_directory(app.static_folder, "sw.js")


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    _seed_demo_history()
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
