"""Local iPhone HTTPS setup; OpenSSL is optional until phone mode is requested."""

import functools
import html
import http.server
import ipaddress
import plistlib
import shutil
import socket
import ssl
import subprocess
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


class WebHandler(http.server.SimpleHTTPRequestHandler):
    """Explicit MIME types for browser modules and WebAssembly on Windows."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
    }


@dataclass(frozen=True)
class PhoneIdentity:
    """Certificate paths outside the public web tree; nothing changes OS trust."""

    certificate: Path
    private_key: Path
    authority: Path
    profile: Path


def phone_host(explicit: str | None = None) -> str:
    """Choose the default-route IPv4 address; explicit addresses support VPN setups."""
    if explicit is not None:
        address = ipaddress.IPv4Address(explicit)
        if address.is_unspecified or address.is_multicast:
            raise ValueError("--phone-host needs this laptop's reachable IPv4 address")
        return str(address)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            # UDP connect chooses a local route without transmitting a packet.
            probe.connect(("192.0.2.1", 80))
            return str(probe.getsockname()[0])
        except OSError as error:
            raise ValueError(
                "Cannot choose a LAN address; supply --phone-host <laptop-ip>"
            ) from error


def create_identity(directory: Path, host: str) -> PhoneIdentity:
    """Create/reuse a private local CA and a 90-day server certificate with IP SANs."""
    executable = shutil.which("openssl")
    if executable is None:
        raise RuntimeError(
            "Phone mode requires OpenSSL 3.x on PATH. See docs/FEATURE_TUTORIALS.md."
        )
    host = phone_host(host)
    directory.mkdir(parents=True, exist_ok=True)

    def run(*arguments: str) -> str:
        result = subprocess.run(
            [executable, *arguments], capture_output=True, text=True, check=False, timeout=30
        )
        if result.returncode:
            raise RuntimeError(f"OpenSSL {arguments[0]} failed: {result.stderr.strip()}")
        return result.stdout

    ca_key, ca_pem = directory / "ca.key", directory / "ca.pem"
    if not ca_key.exists() or not ca_pem.exists():
        run(
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            str(ca_key),
            "-out",
            str(ca_pem),
            "-subj",
            "/CN=dance2music local phone CA",
            "-days",
            "3650",
            "-addext",
            "basicConstraints=critical,CA:TRUE,pathlen:0",
            "-addext",
            "keyUsage=critical,keyCertSign,cRLSign",
        )
        ca_key.chmod(0o600)
    ca_der = directory / "phone-ca.cer"
    run("x509", "-in", str(ca_pem), "-outform", "DER", "-out", str(ca_der))
    certificate, private_key = directory / "server.pem", directory / "server.key"
    host_record = directory / "host.txt"
    reusable = certificate.exists() and private_key.exists() and host_record.exists()
    if reusable and host_record.read_text(encoding="utf-8") == host:
        checked = subprocess.run(
            [executable, "x509", "-in", str(certificate), "-checkend", "86400", "-noout"],
            capture_output=True,
            check=False,
            timeout=10,
        )
        reusable = checked.returncode == 0
    else:
        reusable = False
    if not reusable:
        request, extensions = directory / "server.csr", directory / "server.ext"
        sans = list(dict.fromkeys([f"IP:{host}", "IP:127.0.0.1", "DNS:localhost"]))
        extensions.write_text(
            "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n"
            "extendedKeyUsage=serverAuth\nauthorityKeyIdentifier=keyid,issuer\n"
            + "subjectAltName="
            + ",".join(sans)
            + "\n",
            encoding="utf-8",
        )
        run(
            "req",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            str(private_key),
            "-out",
            str(request),
            "-subj",
            f"/CN={host}",
        )
        run(
            "x509",
            "-req",
            "-in",
            str(request),
            "-CA",
            str(ca_pem),
            "-CAkey",
            str(ca_key),
            "-CAcreateserial",
            "-out",
            str(certificate),
            "-days",
            "90",
            "-sha256",
            "-extfile",
            str(extensions),
        )
        private_key.chmod(0o600)
        host_record.write_text(host, encoding="utf-8")
    run("verify", "-CAfile", str(ca_pem), str(certificate))
    profile = directory / "phone-ca.mobileconfig"
    profile.write_bytes(
        plistlib.dumps(
            {
                "PayloadType": "Configuration",
                "PayloadVersion": 1,
                "PayloadIdentifier": "local.dance2music.phone",
                "PayloadUUID": str(uuid.uuid4()),
                "PayloadDisplayName": "dance2music local phone camera",
                "PayloadDescription": "Trust the local laptop server for Safari camera access.",
                "PayloadContent": [
                    {
                        "PayloadType": "com.apple.security.root",
                        "PayloadVersion": 1,
                        "PayloadIdentifier": "local.dance2music.phone.root",
                        "PayloadUUID": str(uuid.uuid4()),
                        "PayloadDisplayName": "dance2music local phone CA",
                        "PayloadContent": ca_der.read_bytes(),
                    }
                ],
            }
        )
    )
    return PhoneIdentity(certificate, private_key, ca_pem, profile)


def setup_page(app_url: str) -> bytes:
    """Instructions are a local HTML artifact, with no remote QR/image services."""
    safe_url = html.escape(app_url, quote=True)
    return f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Phone camera setup</title>
<style>body{{font:17px system-ui;line-height:1.6;max-width:640px;margin:32px auto;padding:20px;
background:#171614;color:#efe9df}}a{{color:#ffbd73}}li{{margin:16px 0}}
code{{overflow-wrap:anywhere}}</style>
<h1>Dance2Music on your iPhone</h1><p>Use Safari, with the phone and laptop on the same Wi-Fi.</p>
<ol><li><a href="/phone-ca.mobileconfig">Download the local camera certificate</a>.</li>
<li>Open Settings → General → VPN &amp; Device Management. Install
<b>dance2music local phone camera</b>.</li>
<li>Open Settings → General → About → Certificate Trust Settings.
Enable full trust for <b>dance2music local phone CA</b>.</li>
<li>Return to Safari and <a href="{safe_url}">open the instrument</a>.
Tap Start, allow the camera, and tap “Tap for sound” if shown.</li></ol>
<p><code>{safe_url}</code></p><p>Tracking and sound run on the phone.
The laptop serves files. Use the rear camera with your whole body in view.</p>
<p>This installs only a local certificate, no device management.
Remove the profile in Settings when you no longer use this laptop.</p>
<p>If the page cannot load, check the laptop's local-network firewall permission.
If its Wi-Fi address changes, restart the server.</p></html>""".encode()


def setup_handler(
    identity: PhoneIdentity, app_url: str
) -> type[http.server.BaseHTTPRequestHandler]:
    """Expose only a setup page and public CA profile; private paths always return 404."""

    class SetupHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.respond(body=True)

        def do_HEAD(self) -> None:
            self.respond(body=False)

        def respond(self, *, body: bool) -> None:
            path = urlsplit(self.path).path
            if path == "/":
                content, mime = setup_page(app_url), "text/html; charset=utf-8"
            elif path == "/phone-ca.mobileconfig":
                content, mime = identity.profile.read_bytes(), "application/x-apple-aspen-config"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if body:
                self.wfile.write(content)

    return SetupHandler


def serve_phone(web_root: Path, directory: Path, host: str, port: int, setup_port: int) -> None:
    """Serve until Ctrl+C; close both listening sockets even after an error."""
    identity = create_identity(directory, host)
    app_url = f"https://{host}:{port}/live/?phone=1"
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(identity.certificate, identity.private_key)
    handler = functools.partial(WebHandler, directory=str(web_root))
    with http.server.ThreadingHTTPServer(("0.0.0.0", port), handler) as server:
        server.socket = context.wrap_socket(server.socket, server_side=True)
        with http.server.ThreadingHTTPServer(
            ("0.0.0.0", setup_port), setup_handler(identity, app_url)
        ) as setup:
            thread = threading.Thread(target=setup.serve_forever, daemon=True)
            thread.start()
            print(f"iPhone setup: http://{host}:{setup_port}/", flush=True)
            print(f"Instrument:  {app_url}", flush=True)
            print(
                "Install and trust the certificate using the setup page once per laptop.",
                flush=True,
            )
            print("Tracking + sound run on iPhone. Ctrl+C stops both servers.", flush=True)
            try:
                server.serve_forever()
            finally:
                setup.shutdown()
                thread.join(timeout=2)
