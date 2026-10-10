"""One-time local Garmin login (supports MFA). Produces the GARMIN_TOKENS secret.

    pip install -r sync/requirements.txt
    python sync/garmin_login.py                      # prints the token JSON
    python sync/garmin_login.py --repo schnre/Healthy_Football   # also stores it via `gh secret set`

The token contains a refresh token that grants access to your Garmin account –
never commit it, only store it as a GitHub secret.
"""

from __future__ import annotations

import argparse
import getpass
import shutil
import subprocess
import sys
from pathlib import Path

from garminconnect import Garmin, GarminConnectAuthenticationError

TOKEN_DIR = Path.home() / ".garminconnect"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", help="owner/repo – speichert das Token direkt als GitHub-Secret (benötigt gh CLI)")
    args = parser.parse_args()

    email = input("Garmin E-Mail: ").strip()
    password = getpass.getpass("Garmin Passwort: ")
    api = Garmin(email, password, prompt_mfa=lambda: input("MFA-Code: ").strip())
    try:
        api.login(str(TOKEN_DIR))
    except GarminConnectAuthenticationError as err:
        sys.exit(f"Login fehlgeschlagen: {err}")

    tokens = api.client.dumps()
    api.client.dump(str(TOKEN_DIR))
    print(f"\nLogin erfolgreich als {api.get_full_name()}. Tokens gespeichert in {TOKEN_DIR}.")

    if args.repo:
        if not shutil.which("gh"):
            sys.exit("gh CLI nicht gefunden – Secret bitte manuell anlegen (siehe README).")
        subprocess.run(["gh", "secret", "set", "GARMIN_TOKENS", "-R", args.repo], input=tokens, text=True, check=True)
        print(f"Secret GARMIN_TOKENS in {args.repo} gesetzt.")
    else:
        print("\nKopiere diese Zeile als GitHub-Secret GARMIN_TOKENS:\n")
        print(tokens)


if __name__ == "__main__":
    main()
