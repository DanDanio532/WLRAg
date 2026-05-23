#!/usr/bin/env python3
"""
Convert a list of coordinates (lat, lon) into a CSV file (with header) for Supabase import.

EXAMPLES:

1. For a block (blockID = 10) using file "block_10.txt":
   python coords_to_csv.py block_coordinates blockID 10 block_10.txt

2. For a location (locationID = 2) using file "orchard_2.txt":
   python coords_to_csv.py location_coordinates locationID 2 orchard_2.txt

3. Pipe coordinates directly (press Ctrl+D after pasting):
   cat coords.txt | python coords_to_csv.py block_coordinates blockID 5

The output CSV file will be named: import_</td>_<id_column>_<id_value>.csv
Columns: <id_column>, vertexOrder, latitude, longitude
"""

import sys
import re
import os

def parse_coords_file(filename):
    """Read file, return list of (lat, lon) floats."""
    coords = []
    with open(filename, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = re.split(r'[,\s]+', line)
            if len(parts) >= 2:
                try:
                    lat = float(parts[0])
                    lon = float(parts[1])
                    coords.append((lat, lon))
                except ValueError:
                    print(f"Skipping invalid line: {line}", file=sys.stderr)
    return coords

def generate_csv(table_name, id_column, id_value, coords):
    """Generate CSV with header and data rows."""
    header = f"{id_column},vertexOrder,latitude,longitude"
    rows = []
    for idx, (lat, lon) in enumerate(coords):
        rows.append(f"{id_value},{idx},{lat},{lon}")
    return header + "\n" + "\n".join(rows)

def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)

    table = sys.argv[1]          # e.g., block_coordinates or location_coordinates
    id_col = sys.argv[2]         # e.g., blockID or locationID
    try:
        id_val = int(sys.argv[3])
    except ValueError:
        print("id_value must be an integer", file=sys.stderr)
        sys.exit(1)

    if len(sys.argv) >= 5:
        filename = sys.argv[4]
        coords = parse_coords_file(filename)
    else:
        # Read from stdin
        print("Paste coordinates (one per line), then press Ctrl+D (Linux/Mac) or Ctrl+Z then Enter (Windows):", file=sys.stderr)
        coords = parse_coords_file(sys.stdin)

    if not coords:
        print("No valid coordinates found.", file=sys.stderr)
        sys.exit(1)

    csv_content = generate_csv(table, id_col, id_val, coords)

    # Write to a CSV file in the same directory as the script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_filename = f"import_{table}_{id_col}_{id_val}.csv"
    output_path = os.path.join(script_dir, output_filename)

    with open(output_path, 'w') as f:
        f.write(csv_content)

    print(f"CSV written to: {output_path}")
    print(f"Total {len(coords)} coordinate pairs processed.")
    print("\nTo import into Supabase:")
    print(f"1. Go to Table Editor → {table}")
    print("2. Click 'Import' → Choose CSV file")
    print("3. The header row will auto-match columns (or you can verify)")
    print("4. Click Import")

if __name__ == "__main__":
    main()