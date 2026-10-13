import pickle

import yaml
from flask import Flask, request

app = Flask(__name__)


@app.post("/import")
def import_state():
    state = pickle.loads(request.get_data())
    return {"keys": sorted(state)}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/import-yaml")
def import_yaml():
    state = yaml.safe_load(request.get_data())
    return {"keys": sorted(state)}
