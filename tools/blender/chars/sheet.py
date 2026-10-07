import sys
from PIL import Image
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = [Image.open(p).convert('RGB') for p in sys.argv[4:]]
ims = [i.resize((w, int(i.height * w / i.width))) for i in ims]
h = max(i.height for i in ims); rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * w, rows * h), (40, 40, 40))
for k, i in enumerate(ims): S.paste(i, ((k % cols) * w, (k // cols) * h))
S.save(out)
