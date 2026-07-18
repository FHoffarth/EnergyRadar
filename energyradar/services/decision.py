"""Decision Engine.

Einzige Verantwortung: aus der aktuellen Leistung Status und Empfehlung ableiten.
"""


def recommend(power: float) -> tuple[str, str]:
    if power > 1500:
        return "excellent", "☀️ Excellent solar production"
    elif power > 500:
        return "good", "🌤 Good solar production"
    elif power > 10:
        return "limited", "🌥 Limited solar production"
    else:
        return "none", "🌙 No solar production"
