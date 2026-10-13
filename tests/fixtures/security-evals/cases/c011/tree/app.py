import ipaddress
import subprocess

from flask import Flask, request

app = Flask(__name__)


@app.get("/ping")
def ping():
    host = request.args.get("host", "")
    out = subprocess.run(f"ping -c 1 {host}", shell=True, capture_output=True, text=True)
    return out.stdout


@app.get("/trace")
def trace():
    host = str(ipaddress.ip_address(request.args.get("host", "")))
    out = subprocess.run(["traceroute", "-m", "8", host], capture_output=True, text=True)
    return out.stdout
