import urllib.parse
import os
import logging

from energyradar.services.platform_open import open_url, reveal_path

log = logging.getLogger(__name__)

def prepare_email_handoff(subject: str, body: str, attachment_path: str):
    """
    Bereitet den E-Mail-Versand vor.
    1. Zeigt die PDF-Datei im nativen Dateimanager.
    2. Öffnet den Standard-Mailclient via mailto: mit Betreff und Text.
    """
    if not os.path.exists(attachment_path):
        raise RuntimeError("Der E-Mail-Anhang ist nicht mehr verfügbar.")

    abs_path = os.path.abspath(attachment_path)
    try:
        reveal_path(abs_path)
    except Exception:
        # Das Anzeigen des Anhangs ist hilfreich, aber für den Mail-Client
        # nicht erforderlich. Technische Details bleiben ausschließlich im Log.
        log.warning("Anhang konnte nicht im Dateimanager angezeigt werden.", exc_info=True)

    # 2. mailto: Link generieren und öffnen
    # Parameter url-kodieren
    query_params = {
        "subject": subject,
        "body": body
    }
    encoded_query = urllib.parse.urlencode(query_params, quote_via=urllib.parse.quote)
    mailto_url = f"mailto:?{encoded_query}"

    try:
        open_url(mailto_url)
    except Exception as exc:
        log.exception("E-Mail-Client konnte nicht geöffnet werden.")
        raise RuntimeError("Der E-Mail-Client konnte nicht geöffnet werden.") from exc
