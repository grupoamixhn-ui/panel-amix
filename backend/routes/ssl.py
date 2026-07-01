"""SSL certificate management endpoints — for self-hosted installs.

Endpoints:
- GET  /api/ssl/status        : inspect the installed cert (subject/issuer/expiry)
- POST /api/ssl/upload        : upload a new PEM cert+key pair
- POST /api/ssl/letsencrypt   : trigger `certbot --nginx` for a given domain

All endpoints require role=admin.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
import shutil
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import get_current_user

router = APIRouter()

SSL_CERT_PATH = os.environ.get("SSL_CERT_PATH", "/etc/amixpanel/ssl/cert.pem")
SSL_KEY_PATH = os.environ.get("SSL_KEY_PATH", "/etc/amixpanel/ssl/key.pem")


class SslUploadIn(BaseModel):
    cert_pem: str
    key_pem: str
    also_for_flussonic: bool = False


class LetsEncryptIn(BaseModel):
    domain: str
    email: str = ""


@router.get("/ssl/status")
async def ssl_status(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    info: dict[str, Any] = {
        "cert_path": SSL_CERT_PATH,
        "key_path": SSL_KEY_PATH,
        "exists": False,
    }
    if not os.path.exists(SSL_CERT_PATH):
        return info
    info["exists"] = True
    try:
        out = subprocess.run(
            ["openssl", "x509", "-in", SSL_CERT_PATH, "-noout", "-subject", "-issuer",
             "-startdate", "-enddate", "-fingerprint", "-sha256"],
            capture_output=True, text=True, timeout=5,
        )
        for line in out.stdout.splitlines():
            if line.startswith("subject="):
                info["subject"] = line.split("=", 1)[1].strip()
            elif line.startswith("issuer="):
                info["issuer"] = line.split("=", 1)[1].strip()
                info["self_signed"] = info.get("subject") == info["issuer"]
            elif line.startswith("notBefore="):
                info["not_before"] = line.split("=", 1)[1].strip()
            elif line.startswith("notAfter="):
                info["not_after"] = line.split("=", 1)[1].strip()
            elif line.lower().startswith("sha256 fingerprint="):
                info["fingerprint_sha256"] = line.split("=", 1)[1].strip()
    except Exception as e:  # noqa: BLE001
        info["error"] = str(e)
    return info


@router.post("/ssl/upload")
async def ssl_upload(body: SslUploadIn, user=Depends(get_current_user)):
    """Replace the active certificate with user-provided PEM strings.

    Falls back to the sudoers helper at /usr/local/bin/amixpanel-reload-ssl
    when the backend lacks direct write access to SSL_CERT_PATH.
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    if "BEGIN CERTIFICATE" not in body.cert_pem:
        raise HTTPException(status_code=400, detail="cert_pem must be a PEM-encoded certificate")
    if "BEGIN" not in body.key_pem or "PRIVATE KEY" not in body.key_pem:
        raise HTTPException(status_code=400, detail="key_pem must be a PEM-encoded private key")

    try:
        tmp_dir = tempfile.mkdtemp(prefix="ssl-upload-")
        tmp_cert = os.path.join(tmp_dir, "cert.pem")
        tmp_key = os.path.join(tmp_dir, "key.pem")
        with open(tmp_cert, "w") as f:
            f.write(body.cert_pem.strip() + "\n")
        with open(tmp_key, "w") as f:
            f.write(body.key_pem.strip() + "\n")
        os.chmod(tmp_key, 0o600)

        cert_mod = subprocess.run(["openssl", "x509", "-noout", "-modulus", "-in", tmp_cert],
                                  capture_output=True, text=True, timeout=5)
        key_mod = subprocess.run(["openssl", "rsa", "-noout", "-modulus", "-in", tmp_key],
                                 capture_output=True, text=True, timeout=5)
        if cert_mod.returncode != 0 or key_mod.returncode != 0 or cert_mod.stdout != key_mod.stdout:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="Certificate and private key do not match")

        try:
            os.makedirs(os.path.dirname(SSL_CERT_PATH), exist_ok=True)
            shutil.copy2(tmp_cert, SSL_CERT_PATH)
            shutil.copy2(tmp_key, SSL_KEY_PATH)
            os.chmod(SSL_KEY_PATH, 0o600)
        except PermissionError:
            r = subprocess.run(["sudo", "-n", "/usr/local/bin/amixpanel-reload-ssl",
                                tmp_cert, tmp_key], capture_output=True, text=True, timeout=15)
            if r.returncode != 0:
                raise HTTPException(status_code=500,
                                    detail=f"Could not install cert (need sudo). stderr: {r.stderr[:200]}")

        if body.also_for_flussonic:
            flu_dir = "/etc/flussonic/ssl"
            try:
                os.makedirs(flu_dir, exist_ok=True)
                shutil.copy2(SSL_CERT_PATH, os.path.join(flu_dir, "cert.pem"))
                shutil.copy2(SSL_KEY_PATH, os.path.join(flu_dir, "key.pem"))
                os.chmod(os.path.join(flu_dir, "key.pem"), 0o600)
            except PermissionError:
                pass

        try:
            subprocess.run(["sudo", "-n", "nginx", "-s", "reload"],
                           capture_output=True, text=True, timeout=5)
        except Exception:  # noqa: BLE001
            pass

        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"ok": True, "message": "Certificate installed and nginx reloaded"}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ssl/letsencrypt")
async def ssl_letsencrypt(body: LetsEncryptIn, user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if not body.domain or "." not in body.domain:
        raise HTTPException(status_code=400, detail="A valid domain is required (e.g. panel.example.com)")
    cmd = ["sudo", "-n", "certbot", "--nginx", "--non-interactive", "--agree-tos", "-d", body.domain]
    if body.email:
        cmd += ["-m", body.email]
    else:
        cmd += ["--register-unsafely-without-email"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            return {"ok": False, "message": (r.stderr or r.stdout)[-1000:]}
        return {"ok": True, "message": r.stdout[-500:]}
    except FileNotFoundError:
        raise HTTPException(status_code=400, detail="certbot is not installed on this server")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))
