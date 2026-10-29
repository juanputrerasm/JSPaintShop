#!/bin/sh
# Build the git-ignored reverse-engineering workspace in <repo>/re/ from a Paint Shop Pro 6
# install: Ghidra auto-analysis of Psp.exe, the functions only reached through MFC message maps
# and vtables, a full decompile export, then the derived indexes (call graph, strings per
# function, message maps, resources).
#   PSP6_DIR="$HOME/programs/Paint Shop Pro 6" tools/re/decompile.sh
# Needs Ghidra (brew install ghidra) and Python 3. Adapted from OpenMTM2's tools/re.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PSP_DIR=${PSP6_DIR:-"$HOME/programs/Paint Shop Pro 6"}
EXE=Psp.exe
WORK="$REPO/re"
HEADLESS=${GHIDRA_HEADLESS:-$(brew --prefix ghidra 2>/dev/null)/libexec/support/analyzeHeadless}
mkdir -p "$WORK/ghidra" "$WORK/out" "$WORK/notes"
cp "$PSP_DIR/$EXE" "$WORK/ghidra/$EXE"
chmod u+w "$WORK/ghidra/$EXE"
if [ ! -d "$WORK/venv" ]; then
  python3 -m venv "$WORK/venv"
  "$WORK/venv/bin/pip" -q install -r "$HERE/requirements.txt"
fi
if [ -f "$WORK/ghidra/proj.gpr" ]; then
  "$HEADLESS" "$WORK/ghidra" proj -process "$EXE" -noanalysis \
    -scriptPath "$HERE" -postScript ExportAll.java "$WORK/out"
else
  "$HEADLESS" "$WORK/ghidra" proj -import "$WORK/ghidra/$EXE" -max-cpu 8 \
    -scriptPath "$HERE" -postScript FindFuncs.java -postScript ExportAll.java "$WORK/out"
fi
"$WORK/venv/bin/python" "$HERE/postprocess.py"
"$WORK/venv/bin/python" "$HERE/msgmap.py" > "$WORK/out/msgmaps.txt" || true
