from pathlib import Path
import subprocess

import pytest

from energyradar.services import mail_handoff, platform_open


def test_windows_open_path_uses_startfile(monkeypatch, tmp_path):
    target = tmp_path / "Bericht äöü mit Leerzeichen.pdf"
    target.write_text("report", encoding="utf-8")
    opened = []
    monkeypatch.setattr(platform_open.sys, "platform", "win32")
    monkeypatch.setattr(platform_open.os, "startfile", opened.append, raising=False)

    platform_open.open_path(target)

    assert opened == [str(target)]


def test_macos_open_path_uses_native_open_without_shell(monkeypatch, tmp_path):
    target = tmp_path / "Ordner mit Leerzeichen" / "Größe.txt"
    target.parent.mkdir()
    target.write_text("x", encoding="utf-8")
    calls = []
    monkeypatch.setattr(platform_open.sys, "platform", "darwin")
    monkeypatch.setattr(
        platform_open.subprocess,
        "run",
        lambda command, **kwargs: calls.append((command, kwargs)),
    )

    platform_open.open_path(target)

    assert calls == [(["open", str(target)], {"check": True})]


def test_macos_reveal_path_uses_open_dash_r(monkeypatch, tmp_path):
    target = tmp_path / "Bericht Übung.pdf"
    target.write_text("x", encoding="utf-8")
    calls = []
    monkeypatch.setattr(platform_open.sys, "platform", "darwin")
    monkeypatch.setattr(
        platform_open.subprocess,
        "run",
        lambda command, **kwargs: calls.append((command, kwargs)),
    )

    platform_open.reveal_path(target)

    assert calls == [(["open", "-R", str(target.resolve())], {"check": True})]


def test_linux_open_path_uses_xdg_open(monkeypatch, tmp_path):
    target = tmp_path / "exports"
    target.mkdir()
    calls = []
    monkeypatch.setattr(platform_open.sys, "platform", "linux")
    monkeypatch.setattr(
        platform_open.subprocess,
        "run",
        lambda command, **kwargs: calls.append((command, kwargs)),
    )

    platform_open.open_path(target)

    assert calls == [(["xdg-open", str(target)], {"check": True})]


@pytest.mark.parametrize(
    ("platform", "expected"),
    [
        ("win32", ["explorer", "/select,"]),
        ("linux", ["xdg-open"]),
    ],
)
def test_reveal_path_uses_native_file_manager(monkeypatch, tmp_path, platform, expected):
    target = tmp_path / "Export mit Leerzeichen" / "Größe.csv"
    target.parent.mkdir()
    target.write_text("x", encoding="utf-8")
    calls = []
    monkeypatch.setattr(platform_open.sys, "platform", platform)
    monkeypatch.setattr(
        platform_open.subprocess,
        "run",
        lambda command, **kwargs: calls.append((command, kwargs)),
    )

    platform_open.reveal_path(target)

    suffix = str(target.resolve()) if platform == "win32" else str(target.resolve().parent)
    assert calls == [(expected + [suffix], {"check": True})]


@pytest.mark.parametrize(
    ("platform", "command"),
    [
        ("darwin", ["open", "mailto:?subject=Grüße%20aus%20Köln"]),
        ("linux", ["xdg-open", "mailto:?subject=Grüße%20aus%20Köln"]),
    ],
)
def test_url_opener_uses_argument_array_without_shell(monkeypatch, platform, command):
    calls = []
    monkeypatch.setattr(platform_open.sys, "platform", platform)
    monkeypatch.setattr(
        platform_open.subprocess,
        "run",
        lambda actual, **kwargs: calls.append((actual, kwargs)),
    )

    platform_open.open_url("mailto:?subject=Grüße%20aus%20Köln")

    assert calls == [(command, {"check": True})]


def test_windows_url_opener_preserves_startfile(monkeypatch):
    opened = []
    monkeypatch.setattr(platform_open.sys, "platform", "win32")
    monkeypatch.setattr(platform_open.os, "startfile", opened.append, raising=False)

    platform_open.open_url("https://example.invalid/a%20b")

    assert opened == ["https://example.invalid/a%20b"]


def test_missing_path_is_rejected_before_dispatch(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(platform_open.subprocess, "run", lambda *args, **kwargs: calls.append((args, kwargs)))

    with pytest.raises(FileNotFoundError, match="Path does not exist"):
        platform_open.open_path(tmp_path / "missing.pdf")

    assert calls == []


def test_opener_failure_propagates_without_shell(monkeypatch, tmp_path):
    target = tmp_path / "report.pdf"
    target.write_text("x", encoding="utf-8")
    monkeypatch.setattr(platform_open.sys, "platform", "darwin")

    def fail(command, **kwargs):
        assert kwargs == {"check": True}
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(platform_open.subprocess, "run", fail)

    with pytest.raises(subprocess.CalledProcessError):
        platform_open.open_path(target)


def test_mail_handoff_uses_reveal_and_platform_url_opener(monkeypatch, tmp_path):
    target = tmp_path / "Bericht äöü.pdf"
    target.write_text("x", encoding="utf-8")
    revealed = []
    opened_urls = []
    monkeypatch.setattr(mail_handoff, "reveal_path", revealed.append)
    monkeypatch.setattr(mail_handoff, "open_url", opened_urls.append)

    mail_handoff.prepare_email_handoff("PV & Wetter", "Grüße aus Dieburg", str(target))

    assert revealed == [str(target.resolve())]
    assert len(opened_urls) == 1
    assert opened_urls[0].startswith("mailto:?")
    assert "subject=PV%20%26%20Wetter" in opened_urls[0]


def test_mail_handoff_missing_attachment_is_friendly(tmp_path):
    with pytest.raises(RuntimeError, match="Anhang ist nicht mehr verfügbar"):
        mail_handoff.prepare_email_handoff("subject", "body", str(tmp_path / "missing.pdf"))


def test_mail_handoff_opener_failure_is_friendly(monkeypatch, tmp_path):
    target = tmp_path / "report.pdf"
    target.write_text("x", encoding="utf-8")
    monkeypatch.setattr(mail_handoff, "reveal_path", lambda _path: None)
    monkeypatch.setattr(
        mail_handoff,
        "open_url",
        lambda _url: (_ for _ in ()).throw(OSError("private opener details")),
    )

    with pytest.raises(RuntimeError, match="E-Mail-Client konnte nicht geöffnet werden") as error:
        mail_handoff.prepare_email_handoff("subject", "body", str(target))

    assert "private opener details" not in str(error.value)
