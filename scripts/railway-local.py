"""Run a local verification with Railway credentials, without printing or saving secrets."""
import json
import os
import subprocess
import sys

def variables(service):
    return json.loads(subprocess.check_output(["railway", "variables", "-s", service, "--json"], text=True))

env = dict(os.environ)
env.update(variables("ahd-dj"))
env["PG_URL"] = variables("Postgres")["DATABASE_PUBLIC_URL"]
sys.exit(subprocess.call(sys.argv[1:], env=env))
