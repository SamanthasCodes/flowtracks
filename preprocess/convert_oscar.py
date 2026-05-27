#!/usr/bin/env python3
"""
Convert OSCAR ocean-current NetCDF files to webgl-wind PNG + JSON.
Generates a dates.json manifest for multi-step playback.

Usage:
    Single file:  python convert_oscar.py input.nc output_dir/
    Batch folder: python convert_oscar.py /path/to/nc_folder/ output_dir/
"""

import os, sys, json
import numpy as np
import xarray as xr
from PIL import Image

VAR_U = "u"
VAR_V = "v"
CLIP_MIN = -3.0
CLIP_MAX = 3.0
LON_CANDIDATES = ["lon", "longitude", "LON", "LONGITUDE"]
LAT_CANDIDATES = ["lat", "latitude", "LAT", "LATITUDE"]

def normalise(data, vmin, vmax):
    data = np.clip(data, vmin, vmax)
    return ((data - vmin) / (vmax - vmin) * 255.0).astype(np.uint8)

def extract_2d(var):
    data = var.values
    if "time" in var.dims:
        data = data[0]
    dims = [d for d in var.dims if d != "time"]
    if len(dims) != 2:
        raise ValueError(f"Expected 2 spatial dims, got {dims}")
    lat_idx = next(i for i, d in enumerate(dims) if "lat" in d.lower())
    lon_idx = next(i for i, d in enumerate(dims) if "lon" in d.lower())
    if lat_idx > lon_idx:
        data = data.T
    return np.asarray(data, dtype=np.float64)

def convert(nc_path, out_dir, mask_path="land_mask_1440x719.png", flip_lat=True):
    os.makedirs(out_dir, exist_ok=True)
    land_mask = np.array(Image.open(mask_path).convert("L"), dtype=np.uint8)

    ds = xr.open_dataset(nc_path)
    u = extract_2d(ds[VAR_U])
    v = extract_2d(ds[VAR_V])
    u[np.isnan(u)] = 0.0
    v[np.isnan(v)] = 0.0

    if flip_lat:
        u = np.flipud(u)
        v = np.flipud(v)

    u_norm = normalise(u, CLIP_MIN, CLIP_MAX)
    v_norm = normalise(v, CLIP_MIN, CLIP_MAX)

    h, w = u_norm.shape
    texture = np.zeros((h, w, 4), dtype=np.uint8)
    texture[..., 0] = u_norm
    texture[..., 1] = v_norm
    texture[..., 2] = land_mask
    texture[..., 3] = 255

    if "time" in ds.coords and ds.time.size > 0:
        dt_str = str(ds.time.values[0])
        date_str = dt_str.split(".")[0].replace(" ", "T")[:10]
    else:
        date_str = os.path.basename(nc_path).replace(".nc", "")

    Image.fromarray(texture).save(os.path.join(out_dir, f"{date_str}.png"))
    print(f"  wrote {date_str}.png  ({w}x{h})")

    meta = {
        "source": str(nc_path), "date": date_str,
        "width": w, "height": h,
        "uMin": float(u.min()), "uMax": float(u.max()),
        "vMin": float(v.min()), "vMax": float(v.max())
    }
    with open(os.path.join(out_dir, f"{date_str}.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"  wrote {date_str}.json")
    ds.close()
    return date_str

def main():
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr); sys.exit(1)
    src, out_dir = sys.argv[1], sys.argv[2]

    all_dates = []

    if os.path.isdir(src):
        nc_files = sorted(f for f in os.listdir(src) if f.endswith(".nc"))
        if not nc_files:
            print(f"No .nc files in {src}", file=sys.stderr); sys.exit(1)
        print(f"Found {len(nc_files)} NetCDF file(s)")
        for fname in nc_files:
            print(f"\nProcessing {fname} ...")
            try:
                d = convert(os.path.join(src, fname), out_dir)
                all_dates.append(d)
            except Exception as e:
                print(f"  FAILED: {e}", file=sys.stderr)
    else:
        d = convert(src, out_dir)
        all_dates.append(d)

    if all_dates:
        manifest_path = os.path.join(out_dir, "dates.json")
        with open(manifest_path, "w") as f:
            json.dump(sorted(set(all_dates)), f)
        print(f"\nWrote dates.json with {len(set(all_dates))} date(s)")

if __name__ == "__main__":
    main()
