import subprocess
import urllib.parse
import os
import logging
import sys

log = logging.getLogger(__name__)

def prepare_email_handoff(subject: str, body: str, attachment_path: str):
    """
    Bereitet den E-Mail-Versand vor.
    1. Öffnet den Windows Explorer und markiert die PDF-Datei.
    2. Öffnet den Standard-Mailclient via mailto: mit Betreff und Text.
    """
    if not os.path.exists(attachment_path):
        raise FileNotFoundError(f"Anhang nicht gefunden: {attachment_path}")

    # 1. Explorer mit Selektion öffnen
    abs_path = os.path.abspath(attachment_path)
    try:
        # Funktioniert primär unter Windows
        if sys.platform == "win32":
            subprocess.run(["explorer", "/select,", abs_path], check=False)
        else:
            # Fallback für andere OS
            log.warning("Explorer Handoff nur unter Windows unterstützt.")
    except Exception as e:
        log.error(f"Fehler beim Öffnen des Explorers: {e}")

    # 2. mailto: Link generieren und öffnen
    # Parameter url-kodieren
    query_params = {
        "subject": subject,
        "body": body
    }
    encoded_query = urllib.parse.urlencode(query_params, quote_via=urllib.parse.quote)
    mailto_url = f"mailto:?{encoded_query}"

    try:
        if sys.platform == "win32":
            os.startfile(mailto_url)
        else:
            subprocess.run(["xdg-open", mailto_url], check=False)
    except Exception as e:
        log.error(f"Fehler beim Öffnen des Mail-Clients: {e}")
        raise RuntimeError("Konnte den E-Mail-Client nicht öffnen.") from e
