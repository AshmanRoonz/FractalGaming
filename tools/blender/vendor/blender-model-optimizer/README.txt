Vendored from https://github.com/Hinneman/blender-model-optimizer (MIT, see LICENSE) at the commit in COMMIT.txt.
Only the Python package is kept ; tools/blender/ship_remesh.py imports its geometry module (decimate_single: planar pre-pass + multi-pass collapse) without registering the add-on, so it runs headless under Blender 4.1.
