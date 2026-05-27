#!/usr/bin/env python3
"""Generate land_mask_1440x719.png using cartopy."""

import numpy as np
from PIL import Image
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import cartopy.feature as cfeature
from cartopy import crs as ccrs

W, H = 1440, 719
DPI = 200

fig = plt.figure(figsize=(W*2/DPI, H*2/DPI), dpi=DPI, frameon=False)
ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree(central_longitude=180))
ax.set_extent([0, 360, -90, 90], crs=ccrs.PlateCarree())
ax.add_feature(cfeature.LAND, facecolor='white', edgecolor='none')
ax.add_feature(cfeature.OCEAN, facecolor='black', edgecolor='none')
ax.axis('off')
fig.subplots_adjust(0, 0, 1, 1, 0, 0)

plt.savefig('land_mask_2x.png', dpi=DPI, bbox_inches='tight', pad_inches=0)
plt.close()

img = Image.open('land_mask_2x.png').convert('L')
arr = (np.array(img) > 128).astype(np.uint8) * 255
img_bin = Image.fromarray(arr).resize((W, H), Image.LANCZOS)
arr_bin = (np.array(img_bin) > 128).astype(np.uint8) * 255
Image.fromarray(arr_bin).save('land_mask_1440x719.png')

print(f"Saved land_mask_1440x719.png ({W}x{H}), "
      f"{arr_bin.sum()//255}/{H*W} land pixels "
      f"({100*arr_bin.sum()//255/(H*W):.1f}%)")
