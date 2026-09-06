"""blender_path.py - find the Blender executable the ship pipeline should use.

Every script under tools/blender/ runs through Blender's own Python, so the only
thing that needs to locate the binary is the code that *launches* it (fleet_v2.py,
and whatever you paste into a shell). This module is the single place that knows how.

    python tools/blender/blender_path.py          # print the resolved path
    python tools/blender/blender_path.py --all    # list every candidate found

Resolution order (first hit wins):

    1. $LSS_BLENDER                     explicit override, always respected
    2. GLBs/ships/.tools/blender-*/     the portable build the art side runs
    3. Program Files/Blender Foundation/Blender */
    4. blender on PATH

Within 2 and 3 the HIGHEST version number wins, so dropping a newer portable build
beside the old one is enough to switch. Set $LSS_BLENDER to pin a specific one.

History: this used to be a hardcoded `C:\\Program Files\\Blender Foundation\\Blender 4.1\\
blender.exe` in fleet_v2.py and in four README commands. That install is gone; the
pipeline now runs on the portable 5.2.1 LTS. The scripts themselves needed no changes -
BLENDER_EEVEE is still a valid engine id, every mesh operator they call still exists,
and a glTF round-trip preserves both the gun/thruster/cockpit markers and the custom
split normals the cleanup stage depends on.
"""
import glob
import os
import re
import shutil
import sys

ENV_VAR = 'LSS_BLENDER'


def _version_key(path):
    """Sort key from a version in the path: 'blender-5.2.1-windows-x64' -> (5, 2, 1)."""
    nums = re.findall(r'(\d+)\.(\d+)(?:\.(\d+))?', path.replace('\\', '/'))
    if not nums:
        return (0, 0, 0)
    return max(tuple(int(p) for p in (a, b, c or 0)) for a, b, c in nums)


def candidates():
    """Every Blender executable we can find, best (newest) first per source."""
    found = []
    home = os.path.expanduser('~')

    env = os.environ.get(ENV_VAR)
    if env:
        found.append((env, 'env:' + ENV_VAR))

    portable = glob.glob(os.path.join(home, 'GLBs', 'ships', '.tools', 'blender-*', 'blender.exe'))
    for p in sorted(portable, key=_version_key, reverse=True):
        found.append((p, 'portable'))

    installed = glob.glob(r'C:\Program Files\Blender Foundation\Blender *\blender.exe')
    installed += glob.glob(r'C:\Program Files (x86)\Blender Foundation\Blender *\blender.exe')
    for p in sorted(installed, key=_version_key, reverse=True):
        found.append((p, 'installed'))

    which = shutil.which('blender')
    if which:
        found.append((which, 'PATH'))

    seen, out = set(), []
    for p, src in found:
        key = os.path.normcase(os.path.abspath(p))
        if key not in seen:
            seen.add(key)
            out.append((p, src, os.path.isfile(p)))
    return out


def find_blender(required=True):
    """Absolute path to the Blender executable, or None / SystemExit if there is none."""
    # An explicit override that does not exist is an error, never a silent fallback:
    # quietly running a different Blender than the one you pinned is the worse failure.
    env = os.environ.get(ENV_VAR)
    if env and not os.path.isfile(env):
        sys.exit('$%s is set to a file that does not exist:\n  %s' % (ENV_VAR, env))

    for path, _src, exists in candidates():
        if exists:
            return path
    if not required:
        return None
    lines = ['Blender not found. Looked for:',
             '  $%s' % ENV_VAR,
             '  ~/GLBs/ships/.tools/blender-*/blender.exe',
             '  C:\\Program Files\\Blender Foundation\\Blender *\\blender.exe',
             '  blender on PATH',
             '',
             'Set the override, e.g.:',
             '  set %s=C:\\path\\to\\blender.exe        (cmd)' % ENV_VAR,
             '  $env:%s = "C:\\path\\to\\blender.exe"   (PowerShell)' % ENV_VAR,
             '  export %s=/c/path/to/blender.exe        (bash)' % ENV_VAR]
    sys.exit('\n'.join(lines))


if __name__ == '__main__':
    if '--all' in sys.argv[1:]:
        for path, src, exists in candidates():
            print('%-4s %-10s %s' % ('ok' if exists else 'MISS', src, path))
    else:
        print(find_blender())
