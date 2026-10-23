"""
ReHabRep - Delete ALL ReHabRep tables and recreate them with demo data.

Use this after the table layout changes (new version of models.py).
It only touches the database in DATABASE_URL (ReHabRep's own database).

    python src\\reset_db.py --yes

Keeps secrets\\rehabrep.key (the encryption key) - do NOT delete that file.
"""

import os
import shutil
import sys

from database import DATA_DIR, DATABASE_URL, Base, engine


def main():
    if "--yes" not in sys.argv:
        print("This deletes ALL ReHabRep data in:")
        print(f"   {DATABASE_URL}")
        print("Run again with --yes to confirm:  python src\\reset_db.py --yes")
        return

    import models  # noqa: F401  (registers every table)

    Base.metadata.drop_all(bind=engine)
    print("All ReHabRep tables dropped.")

    cred_dir = os.path.join(DATA_DIR, "credentials")
    if os.path.isdir(cred_dir):
        shutil.rmtree(cred_dir)
        print("Old credential documents removed.")

    import seed

    seed.main()


if __name__ == "__main__":
    main()