"""Local certificate and HTTP/TLS contracts; no camera or external network."""

import http.server
import plistlib
import shutil
import ssl
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

from live import main, parse_args
from web.phone_server import PhoneIdentity, create_identity, phone_host, setup_handler, setup_page


@pytest.fixture(scope="module")
def identity(tmp_path_factory: pytest.TempPathFactory) -> PhoneIdentity:
    if not shutil.which("openssl"):
        pytest.skip("OpenSSL 3.x is required for phone certificate integration tests")
    return create_identity(tmp_path_factory.mktemp("phone-certs"), "192.168.1.50")


@contextmanager
def serving(server: http.server.ThreadingHTTPServer) -> Iterator[str]:
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    protocol = "https" if isinstance(server.socket, ssl.SSLSocket) else "http"
    try:
        yield f"{protocol}://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_profile_contains_only_public_root_and_certificate_is_reused(
    identity: PhoneIdentity,
) -> None:
    profile = plistlib.loads(identity.profile.read_bytes())
    assert profile["PayloadContent"][0]["PayloadType"] == "com.apple.security.root"
    assert b"PRIVATE KEY" not in identity.profile.read_bytes()
    original = identity.certificate.read_bytes()
    again = create_identity(identity.certificate.parent, "192.168.1.50")
    assert again.certificate.read_bytes() == original


def test_new_ip_uses_same_ca_but_regenerates_leaf(tmp_path: Path) -> None:
    if not shutil.which("openssl"):
        pytest.skip("OpenSSL unavailable")
    first = create_identity(tmp_path, "192.168.1.50")
    authority, leaf = first.authority.read_bytes(), first.certificate.read_bytes()
    second = create_identity(tmp_path, "192.168.1.51")
    assert second.authority.read_bytes() == authority
    assert second.certificate.read_bytes() != leaf


def test_tls_chain_ip_san_and_setup_key_isolation(identity: PhoneIdentity) -> None:
    handler = setup_handler(identity, "https://192.168.1.50:5092/live/?phone=1")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(identity.certificate, identity.private_key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    client = ssl.create_default_context(cafile=str(identity.authority))
    with serving(server) as url:
        with urllib.request.urlopen(url, context=client) as response:
            assert b"Certificate Trust Settings" in response.read()
        with urllib.request.urlopen(url + "/phone-ca.mobileconfig", context=client) as response:
            assert response.headers["Content-Type"] == "application/x-apple-aspen-config"
        for path in ("/ca.key", "/server.key", "/../ca.key", "/live/"):
            with pytest.raises(urllib.error.HTTPError) as failure:
                urllib.request.urlopen(url + path, context=client)
            assert failure.value.code == 404


def test_host_validation_and_page_escaping() -> None:
    assert phone_host("192.168.1.50") == "192.168.1.50"
    for value in ("0.0.0.0", "224.1.1.1", "not-an-ip", "192.168.1.1\nsubjectAltName=evil"):
        with pytest.raises(ValueError):
            phone_host(value)
    assert b"&quot;&gt;&lt;script&gt;" in setup_page('https://example/"><script>')


def test_missing_openssl_has_actionable_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(shutil, "which", lambda _: None)
    with pytest.raises(RuntimeError, match="OpenSSL 3.x"):
        create_identity(tmp_path, "127.0.0.1")


@pytest.mark.parametrize(
    "arguments",
    [
        ["--port", "0"],
        ["--phone", "--port", "65535"],
        ["--phone", "--setup-port", "5092"],
        ["--phone-host", "127.0.0.1"],
    ],
)
def test_cli_rejects_invalid_listener_options(arguments: list[str]) -> None:
    with pytest.raises(SystemExit) as failure:
        parse_args(arguments)
    assert failure.value.code == 2


def test_cli_failure_is_nonzero_and_import_has_no_device_effects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("live.phone_host", lambda _: "127.0.0.1")

    def failure(*_: object) -> None:
        raise OSError("test listener failure")

    monkeypatch.setattr("live.serve_phone", failure)
    assert main(["--phone", "--no-browser"]) == 1
    assert parse_args([]).phone is False
