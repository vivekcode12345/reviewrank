#!/usr/bin/env python3
"""Generate simple PNG icons for ReviewRank extension"""
import struct
import zlib
import os

def create_png(size, color_rgb):
    """Create a simple solid-color PNG with rounded feel (just a colored square)"""
    width = height = size
    r, g, b = color_raw = color_rgb
    
    # Create raw pixel data with alpha channel
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter byte
        for x in range(width):
            # Simple rounded corners
            corner_radius = size // 4
            cx = min(x, width - 1 - x)
            cy = min(y, height - 1 - y)
            if cx < corner_radius and cy < corner_radius:
                # Corner - check if inside circle
                dx = corner_radius - cx
                dy = corner_radius - cy
                if dx*dx + dy*dy > corner_radius*corner_radius:
                    raw_data += b'\x00\x00\x00\x00'  # transparent
                    continue
            raw_data += bytes([r, g, b, 255])
    
    compressed = zlib.compress(raw_data)
    
    def chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    return png

base_dir = os.path.dirname(os.path.abspath(__file__))
icons_dir = os.path.join(base_dir, 'icons')
os.makedirs(icons_dir, exist_ok=True)

# Purple gradient-like solid color for the icon
color = (102, 126, 234)  # #667eea

for size in [16, 48, 128]:
    png_data = create_png(size, color)
    path = os.path.join(icons_dir, f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(png_data)
    print(f'Created icon{size}.png ({len(png_data)} bytes)')

print('Done!')
