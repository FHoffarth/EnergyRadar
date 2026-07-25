"""Zentrales Wörterbuch aller deutschen UI-Texte für EnergyRadar.

Kein User-facing String darf direkt in QML-Dateien oder Viewmodels
hart codiert sein. Alle Texte kommen von hier, damit eine spätere
Erweiterung um andere Sprachen ohne Refaktorierung möglich ist.

Verwendung:
    from energyradar.ui.strings_de import S
    S.verdict_importing(820)  # → "Du beziehst gerade 820 W aus dem Netz."
"""
from __future__ import annotations

from datetime import datetime, timezone


def _fmt_power(watts: float) -> str:
    """Leistungswert in benutzerfreundliches deutsches Format."""
    abs_w = abs(watts)
    if abs_w >= 1000:
        kw = abs_w / 1000
        # Deutsches Dezimalkomma
        return f"{kw:.2f} kW".replace(".", ",")
    return f"{round(abs_w):,} W".replace(",", ".")


def _fmt_energy(kwh: float) -> str:
    if abs(kwh) >= 100:
        return f"{round(kwh):,} kWh".replace(",", ".")
    return f"{kwh:.2f} kWh".replace(".", ",")


def _relative_time(dt: datetime) -> str:
    """'vor 3 Minuten', 'vor 1 Stunde', 'gerade eben', usw."""
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta_s = (now - dt.astimezone(timezone.utc)).total_seconds()
    if delta_s < 10:
        return "gerade eben"
    if delta_s < 90:
        return f"vor {int(delta_s)} Sekunden"
    minutes = round(delta_s / 60)
    if minutes < 60:
        return f"vor {minutes} Minute{'n' if minutes != 1 else ''}"
    hours = round(delta_s / 3600)
    return f"vor {hours} Stunde{'n' if hours != 1 else ''}"


class _Strings:
    """Alle UI-Texte als Methoden oder Konstanten."""

    # ------------------------------------------------------------------ #
    # Tabs / Navigation
    # ------------------------------------------------------------------ #
    tab_now = "Jetzt"
    tab_today = "Heute"
    tab_devices = "Geräte"
    tab_settings = "Einstellungen"
    app_name = "EnergyRadar"

    # ------------------------------------------------------------------ #
    # Jetzt-Screen – Verdikt-Sätze
    # ------------------------------------------------------------------ #

    def verdict_importing(self, power_w: float) -> str:
        return f"Du beziehst gerade {_fmt_power(power_w)} aus dem Netz."

    def verdict_exporting(self, power_w: float) -> str:
        return f"Du speist gerade {_fmt_power(power_w)} ins Netz ein."

    def verdict_balanced(self) -> str:
        return "Du beziehst gerade keinen Strom aus dem Netz."

    def verdict_grid_unavailable(self) -> str:
        return "Die aktuelle Netzleistung ist derzeit nicht verfügbar."

    def verdict_pin_locked(self) -> str:
        return "Der Stromzähler ist noch nicht PIN-entsperrt."

    def verdict_no_source(self) -> str:
        return "Keine Datenquelle eingerichtet."

    def verdict_error(self) -> str:
        return "Gerät momentan nicht erreichbar."

    def verdict_connecting(self) -> str:
        return "Verbindung wird hergestellt …"

    # ------------------------------------------------------------------ #
    # Jetzt-Screen – Messwert-Labels
    # ------------------------------------------------------------------ #
    label_pv = "Solarleistung"
    label_grid = "Netzbezug"
    label_consumption = "Verbrauch"
    label_unknown = "–"
    unit_w = "W"
    unit_kw = "kW"
    unit_kwh = "kWh"

    # ------------------------------------------------------------------ #
    # Jetzt-Screen – Frische / Aktualität
    # ------------------------------------------------------------------ #

    def freshness_live(self, time_str: str) -> str:
        return f"Aktuell · {time_str}"

    def freshness_stale(self, age: str) -> str:
        return f"Veraltet · {age}"

    freshness_unavailable = "Nicht verfügbar"
    freshness_no_source = "Keine Quelle"

    # ------------------------------------------------------------------ #
    # PIN-Lock-Banner
    # ------------------------------------------------------------------ #
    pin_lock_banner = (
        "Der Netzzähler ist noch nicht freigeschaltet. "
        "Entsperre ihn mit deiner PIN, um Netzleistungsdaten zu erhalten."
    )

    # ------------------------------------------------------------------ #
    # Heute-Screen
    # ------------------------------------------------------------------ #
    today_generated = "Heute erzeugt"
    today_import_total = "Netzbezug gesamt"
    today_export_total = "Einspeisung gesamt"
    today_chart_title = "Verlauf Solarleistung"
    today_no_history = "Noch keine Daten für heute aufgezeichnet."
    today_no_source = "Keine Datenquelle eingerichtet."

    # ------------------------------------------------------------------ #
    # Geräte-Screen
    # ------------------------------------------------------------------ #
    devices_title = "Geräte & Datenqualität"
    device_fronius = "Fronius Wechselrichter"
    device_mt175 = "Stromzähler (MT175)"
    device_status_connected = "Verbunden"
    device_status_unavailable = "Nicht erreichbar"
    device_status_error = "Fehler"
    device_status_unconfigured = "Nicht eingerichtet"
    device_last_seen_never = "Noch nie verbunden"
    device_test_btn = "Verbindung testen"
    device_testing = "Wird getestet …"
    device_test_ok = "Erreichbar"
    device_test_failed = "Nicht erreichbar"

    def device_last_seen(self, dt: datetime) -> str:
        return f"Zuletzt gesehen {_relative_time(dt)}"

    # Fronius measurements
    avail_pv_power = "Aktuelle Solarleistung"
    avail_energy_today = "Erzeugte Energie (heute)"
    avail_energy_year = "Erzeugte Energie (Jahr)"
    avail_energy_total = "Erzeugte Energie (gesamt)"

    # MT175 measurements
    avail_grid_power = "Aktuelle Netzleistung"
    avail_grid_import = "Bezugsenergie gesamt"
    avail_grid_export = "Einspeiseenergie gesamt"
    avail_grid_phases = "Phasenleistungen L1/L2/L3"
    unavail_pin_locked = "Netzleistung (Zähler nicht entsperrt)"

    # ------------------------------------------------------------------ #
    # Einstellungen-Screen
    # ------------------------------------------------------------------ #
    settings_title = "Einstellungen"
    settings_section_devices = "Geräte"
    settings_section_data = "Daten"
    settings_section_display = "Darstellung"

    settings_fronius_label = "Fronius-Adresse"
    settings_fronius_hint = "Lokale IP-Adresse oder Hostname, z. B. fronius.local"
    settings_mt175_label = "Stromzähler-Adresse"
    settings_mt175_hint = "HTTP-Adresse des Tasmota-Lesegeräts, z. B. 192.168.1.50"

    settings_refresh_label = "Aktualisierungsintervall"
    settings_refresh_seconds = "Sekunden"

    settings_timezone_label = "Zeitzone"
    settings_theme_label = "Darstellung"
    settings_theme_dark = "Dunkel"
    settings_theme_light = "Hell"
    settings_theme_system = "Systemeinstellung"

    settings_save = "Speichern"
    settings_test = "Testen"
    settings_saved_ok = "Gespeichert"
    settings_save_error = "Fehler beim Speichern"
    settings_test_ok = "Gerät erreichbar"
    settings_test_failed = "Gerät nicht erreichbar"
    settings_invalid_address = "Ungültige Adresse – nur lokale Netzadressen erlaubt."

    # ------------------------------------------------------------------ #
    # Helpers for external use
    # ------------------------------------------------------------------ #

    def fmt_power(self, watts: float | None) -> str:
        if watts is None:
            return self.label_unknown
        return _fmt_power(watts)

    def fmt_energy(self, kwh: float | None) -> str:
        if kwh is None:
            return self.label_unknown
        return _fmt_energy(kwh)

    def relative_time(self, dt: datetime) -> str:
        return _relative_time(dt)


# Singleton instance
S = _Strings()
