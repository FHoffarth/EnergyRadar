"""EnergyRadar – Flask-App.

Orchestriert Collector, Decision Engine und Storage. Keine eigene Fachlogik.
"""

from datetime import datetime

from flask import Flask, jsonify, render_template, send_from_directory

import config
from collectors import fronius
from services import decision, storage

app = Flask(__name__)


def _seed_demo_history() -> None:
    """Im Demo-Modus einmalig eine Tageskurve anlegen,
    damit Diagramm und Peak sofort sichtbar sind."""
    if config.DEMO and not storage.has_data_for_today():
        storage.save_many(fronius.demo_history(datetime.now()))


@app.route("/api/live")
def live():
    try:
        reading = fronius.read_demo() if config.DEMO else fronius.read()
    except Exception:
        return jsonify({"ok": False}), 503

    storage.save(reading)

    level, text = decision.recommend(reading.power)
    peak = storage.peak_today()

    return jsonify({
        "ok": True,
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
