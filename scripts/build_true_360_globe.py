from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "artifacts" / "new-globe" / "source-frames"
OUTPUT_DIR = ROOT / "artifacts" / "new-globe" / "true-360-frames"
TEXTURE_PATH = ROOT / "artifacts" / "new-globe" / "reconstructed-surface.png"
PROCEDURAL_TEXTURE_PATH = (
    ROOT / "artifacts" / "new-globe" / "procedural-missing-surface.png"
)
RAW_TEXTURE_PATH = ROOT / "artifacts" / "new-globe" / "reconstructed-surface-raw.png"
COUNTRY_MAP_PATH = ROOT / "public" / "hologram" / "globe-country-map.png"
CITY_MAP_PATH = ROOT / "public" / "hologram" / "globe-city-emission.png"

FRAME_COUNT = 240
TEXTURE_WIDTH = 1536
TEXTURE_HEIGHT = 768
CENTER_X = 645.0
CENTER_Y = 277.0
RADIUS = 214.0
SURFACE_RADIUS = RADIUS * 0.955
MAP_LONGITUDE_SHIFT = 154
FAULT_START = 875
FAULT_SOLID_START = 995
FAULT_SOLID_END = 1235
FAULT_END = 1365


def estimate_rotation_steps(frames: list[np.ndarray]) -> np.ndarray:
    steps: list[float] = []
    mask = np.zeros(frames[0].shape[:2], dtype=np.uint8)
    cv2.circle(
        mask,
        (round(CENTER_X), round(CENTER_Y)),
        round(RADIUS * 0.86),
        255,
        thickness=-1,
    )

    for previous, current in zip(frames, frames[1:]):
        previous_gray = cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY)
        current_gray = cv2.cvtColor(current, cv2.COLOR_BGR2GRAY)
        points = cv2.goodFeaturesToTrack(
            previous_gray,
            maxCorners=1600,
            qualityLevel=0.008,
            minDistance=3,
            blockSize=5,
            mask=mask,
        )
        if points is None:
            raise RuntimeError("Could not find enough globe features to measure rotation.")

        tracked, status, errors = cv2.calcOpticalFlowPyrLK(
            previous_gray,
            current_gray,
            points,
            None,
            winSize=(25, 25),
            maxLevel=4,
            criteria=(
                cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT,
                40,
                0.001,
            ),
        )
        if tracked is None or status is None:
            raise RuntimeError("Could not track globe surface features.")

        source = points.reshape(-1, 2)
        destination = tracked.reshape(-1, 2)
        valid = status.reshape(-1).astype(bool)
        if errors is not None:
            valid &= errors.reshape(-1) < 20
        source = source[valid]
        destination = destination[valid]

        normalized_y = (source[:, 1] - CENTER_Y) / RADIUS
        cos_latitude = np.sqrt(np.maximum(1 - normalized_y**2, 0.01))
        source_x = (source[:, 0] - CENTER_X) / (RADIUS * cos_latitude)
        destination_x = (
            destination[:, 0] - CENTER_X
        ) / (RADIUS * cos_latitude)

        plausible = (
            (np.abs(source_x) < 0.72)
            & (np.abs(destination_x) < 0.72)
            & (np.abs(destination[:, 1] - source[:, 1]) < 6)
            & (np.abs(destination[:, 0] - source[:, 0]) < 12)
        )
        delta = np.arcsin(np.clip(destination_x[plausible], -0.999, 0.999))
        delta -= np.arcsin(np.clip(source_x[plausible], -0.999, 0.999))
        if len(delta) < 30:
            raise RuntimeError("Not enough reliable globe tracks remained.")
        steps.append(float(np.median(delta)))

    steps_array = np.asarray(steps, dtype=np.float64)
    padded = np.pad(steps_array, (3, 3), mode="edge")
    kernel = np.asarray([1, 2, 3, 4, 3, 2, 1], dtype=np.float64)
    kernel /= kernel.sum()
    return np.convolve(padded, kernel, mode="valid")


def sphere_coordinates() -> tuple[np.ndarray, ...]:
    left = round(CENTER_X - RADIUS)
    top = round(CENTER_Y - RADIUS)
    diameter = round(RADIUS * 2) + 1
    y, x = np.mgrid[0:diameter, 0:diameter].astype(np.float32)
    normalized_x = (x + left - CENTER_X) / RADIUS
    normalized_y = (CENTER_Y - (y + top)) / RADIUS
    radial_squared = normalized_x**2 + normalized_y**2
    valid = radial_squared < (SURFACE_RADIUS / RADIUS) ** 2
    z = np.sqrt(np.maximum(1 - radial_squared, 0))
    latitude = np.arcsin(np.clip(normalized_y, -1, 1))
    cos_latitude = np.maximum(np.cos(latitude), 1e-4)
    relative_longitude = np.arcsin(
        np.clip(normalized_x / cos_latitude, -1, 1)
    )
    return (
        left,
        top,
        normalized_x,
        normalized_y,
        z,
        latitude,
        relative_longitude,
        valid,
    )


def reconstruct_texture(
    frames: list[np.ndarray],
    angles: np.ndarray,
) -> np.ndarray:
    global_longitudes = np.linspace(
        -np.pi,
        np.pi,
        TEXTURE_WIDTH,
        endpoint=False,
        dtype=np.float64,
    )
    latitudes = np.linspace(
        np.pi / 2,
        -np.pi / 2,
        TEXTURE_HEIGHT,
        dtype=np.float64,
    )

    longitude_grid, latitude_grid = np.meshgrid(
        global_longitudes,
        latitudes,
    )
    cos_latitude = np.cos(latitude_grid)
    map_y = (
        CENTER_Y - RADIUS * np.sin(latitude_grid)
    ).astype(np.float32)

    accumulation = np.zeros(
        (TEXTURE_HEIGHT, TEXTURE_WIDTH, 3),
        dtype=np.float64,
    )
    weight_sum = np.zeros(
        (TEXTURE_HEIGHT, TEXTURE_WIDTH),
        dtype=np.float64,
    )
    for frame_index, (frame, angle) in enumerate(zip(frames, angles)):
        relative_longitude = np.arctan2(
            np.sin(longitude_grid + angle),
            np.cos(longitude_grid + angle),
        )
        map_x = (
            CENTER_X
            + RADIUS * cos_latitude * np.sin(relative_longitude)
        ).astype(np.float32)
        sampled = cv2.remap(
            frame,
            map_x,
            map_y,
            cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REFLECT,
        ).astype(np.float64)

        # Central observations dominate, while overlapping endpoint views blend
        # gradually instead of switching at a longitude boundary.
        front_facing = np.clip(np.cos(relative_longitude), 0, 1)
        sample_weight = np.power(front_facing, 10)
        accumulation += sampled * sample_weight[..., None]
        weight_sum += sample_weight

    texture = accumulation / np.maximum(weight_sum[..., None], 1e-8)
    texture = np.clip(texture, 0, 255).astype(np.uint8)
    texture = cv2.GaussianBlur(texture, (0, 0), sigmaX=0.25, sigmaY=0.2)
    cv2.imwrite(str(RAW_TEXTURE_PATH), texture)
    return texture


def smoothstep(value: np.ndarray) -> np.ndarray:
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def build_procedural_surface(texture: np.ndarray) -> np.ndarray:
    country = cv2.imread(str(COUNTRY_MAP_PATH), cv2.IMREAD_COLOR)
    city = cv2.imread(str(CITY_MAP_PATH), cv2.IMREAD_UNCHANGED)
    if country is None or city is None:
        raise RuntimeError("The globe country/city maps could not be loaded.")

    country = cv2.resize(
        country,
        (TEXTURE_WIDTH, TEXTURE_HEIGHT),
        interpolation=cv2.INTER_AREA,
    )
    city = cv2.resize(
        city,
        (TEXTURE_WIDTH, TEXTURE_HEIGHT),
        interpolation=cv2.INTER_AREA,
    )
    country = np.roll(country, MAP_LONGITUDE_SHIFT, axis=1)
    city = np.roll(city, MAP_LONGITUDE_SHIFT, axis=1)

    land = country[:, :, 2].astype(np.float32) / 255
    border = country[:, :, 1].astype(np.float32) / 255
    coast = cv2.morphologyEx(
        (land > 0.42).astype(np.uint8),
        cv2.MORPH_GRADIENT,
        np.ones((3, 3), dtype=np.uint8),
    ).astype(np.float32)
    border = np.maximum(border, coast)
    border = cv2.GaussianBlur(border, (0, 0), sigmaX=0.65, sigmaY=0.65)
    border_glow = cv2.GaussianBlur(border, (0, 0), sigmaX=2.4, sigmaY=2.0)

    ordinary = city[:, :, 2].astype(np.float32) / 255
    major = city[:, :, 1].astype(np.float32) / 255
    special = city[:, :, 0].astype(np.float32) / 255
    halo = city[:, :, 3].astype(np.float32) / 255
    city_energy = ordinary * 0.34 + major * 1.35 + special * 3.4 + halo * 0.18
    city_glow = cv2.GaussianBlur(city_energy, (0, 0), sigmaX=2.0, sigmaY=1.5)

    # Build the unobserved side from the color and illumination immediately
    # surrounding it. This keeps the generated hemisphere inside the exact
    # palette of the source video instead of introducing a new CG-looking blue.
    left_sample = texture[:, FAULT_START - 28 : FAULT_START + 1].mean(
        axis=1,
        keepdims=True,
    )
    right_sample = texture[:, FAULT_END : FAULT_END + 29].mean(
        axis=1,
        keepdims=True,
    )
    interpolation = np.linspace(
        0,
        1,
        FAULT_END - FAULT_START,
        endpoint=False,
        dtype=np.float32,
    )[None, :, None]
    bridge = left_sample * (1 - interpolation) + right_sample * interpolation
    bridge = cv2.GaussianBlur(
        bridge.astype(np.float32),
        (0, 0),
        sigmaX=18,
        sigmaY=18,
    )
    donor = texture[:, 250:740].astype(np.float32)
    donor = cv2.resize(
        donor,
        (FAULT_END - FAULT_START, TEXTURE_HEIGHT),
        interpolation=cv2.INTER_CUBIC,
    )
    donor_detail = donor - cv2.GaussianBlur(
        donor,
        (0, 0),
        sigmaX=12,
        sigmaY=7,
    )
    bridge += donor_detail * 0.58

    procedural = texture.astype(np.float32).copy()
    region = procedural[:, FAULT_START:FAULT_END]
    region[:] = bridge

    land_region = land[:, FAULT_START:FAULT_END, None]
    border_region = border[:, FAULT_START:FAULT_END, None]
    glow_region = border_glow[:, FAULT_START:FAULT_END, None]
    city_region = city_energy[:, FAULT_START:FAULT_END, None]
    city_glow_region = city_glow[:, FAULT_START:FAULT_END, None]

    region += land_region * np.array([9.0, 4.4, 1.2], dtype=np.float32)
    region += glow_region * np.array([45.0, 25.0, 9.0], dtype=np.float32)
    region += border_region * np.array([158.0, 108.0, 58.0], dtype=np.float32)
    region += city_glow_region * np.array([38.0, 20.0, 7.0], dtype=np.float32)
    region += city_region * np.array([135.0, 94.0, 48.0], dtype=np.float32)

    # Restore the source's faint horizontal hologram raster and organic grain.
    y = np.arange(TEXTURE_HEIGHT, dtype=np.float32)[:, None, None]
    scanline = (0.52 + 0.48 * np.sin(y * np.pi * 0.92)) * 1.4
    region += scanline * np.array([1.0, 0.58, 0.22], dtype=np.float32)
    rng = np.random.default_rng(360)
    land_sparkles = (
        (rng.random(region.shape[:2]) > 0.9968)
        * (land[:, FAULT_START:FAULT_END] > 0.4)
    ).astype(np.float32)
    land_sparkles = cv2.GaussianBlur(
        land_sparkles,
        (0, 0),
        sigmaX=0.75,
        sigmaY=0.55,
    )[:, :, None]
    region += land_sparkles * np.array([240.0, 174.0, 92.0], dtype=np.float32)
    grain = cv2.GaussianBlur(
        rng.normal(0, 1, region.shape[:2]).astype(np.float32),
        (0, 0),
        sigmaX=0.45,
        sigmaY=0.25,
    )[:, :, None]
    region += grain * np.array([2.4, 1.2, 0.45], dtype=np.float32)

    procedural = np.clip(procedural, 0, 255)
    cv2.imwrite(
        str(PROCEDURAL_TEXTURE_PATH),
        procedural.astype(np.uint8),
    )
    return procedural


def repair_fault_band(texture: np.ndarray) -> np.ndarray:
    procedural = build_procedural_surface(texture)
    x = np.arange(TEXTURE_WIDTH, dtype=np.float32)
    enter = smoothstep(
        (x - FAULT_START) / (FAULT_SOLID_START - FAULT_START)
    )
    leave = 1 - smoothstep(
        (x - FAULT_SOLID_END) / (FAULT_END - FAULT_SOLID_END)
    )
    blend = np.minimum(enter, leave)[None, :, None]
    repaired = (
        texture.astype(np.float32) * (1 - blend)
        + procedural * blend
    )
    repaired = np.clip(repaired, 0, 255).astype(np.uint8)
    cv2.imwrite(str(TEXTURE_PATH), repaired)
    return repaired


def render_surface(
    texture: np.ndarray,
    angle: float,
) -> tuple[np.ndarray, np.ndarray]:
    (
        _left,
        _top,
        _normalized_x,
        _normalized_y,
        _z,
        latitude,
        relative_longitude,
        valid,
    ) = sphere_coordinates()
    global_longitude = relative_longitude - angle
    map_x = np.mod(
        (global_longitude / (2 * np.pi) + 0.5) * TEXTURE_WIDTH,
        TEXTURE_WIDTH,
    ).astype(np.float32)
    map_y = np.clip(
        (0.5 - latitude / np.pi) * (TEXTURE_HEIGHT - 1),
        0,
        TEXTURE_HEIGHT - 1,
    ).astype(np.float32)
    rendered = cv2.remap(
        texture,
        map_x,
        map_y,
        cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_WRAP,
    )
    rendered[~valid] = 0
    return rendered, valid


def composite_surface(
    background: np.ndarray,
    rendered: np.ndarray,
    valid: np.ndarray,
) -> np.ndarray:
    left, top, *_ = sphere_coordinates()
    diameter = valid.shape[0]
    output = background.copy()
    destination = output[top : top + diameter, left : left + diameter]

    y, x = np.mgrid[0:diameter, 0:diameter].astype(np.float32)
    distance = np.sqrt(
        (x + left - CENTER_X) ** 2 + (y + top - CENTER_Y) ** 2
    )
    alpha = 1 - np.clip(
        (distance - RADIUS * 0.88) / (RADIUS * 0.07),
        0,
        1,
    )
    alpha *= valid
    alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=1.2, sigmaY=1.2)
    alpha = alpha[..., None]
    destination[:] = np.clip(
        destination.astype(np.float32) * (1 - alpha)
        + rendered.astype(np.float32) * alpha,
        0,
        255,
    ).astype(np.uint8)
    return output


def main() -> None:
    frame_paths = sorted(SOURCE_DIR.glob("frame-*.png"))
    if len(frame_paths) != 121:
        raise RuntimeError(f"Expected 121 source frames, found {len(frame_paths)}")

    frames = [cv2.imread(str(path), cv2.IMREAD_COLOR) for path in frame_paths]
    if any(frame is None for frame in frames):
        raise RuntimeError("One or more new globe frames could not be decoded.")

    steps = estimate_rotation_steps(frames)
    source_angles = np.concatenate(([0.0], np.cumsum(steps)))
    texture = reconstruct_texture(frames, source_angles)
    texture = repair_fault_band(texture)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for old_frame in OUTPUT_DIR.glob("frame-*.png"):
        old_frame.unlink()

    for index in range(FRAME_COUNT):
        angle = source_angles[0] + (index / FRAME_COUNT) * (2 * np.pi)
        rendered, valid = render_surface(texture, angle)
        # The plate outside the globe does not need to rotate. Keeping one clean
        # generated frame prevents the source clip's five-second background
        # reset from reintroducing a visible hitch halfway through the new loop.
        background = frames[0]
        output = composite_surface(background, rendered, valid)
        output_path = OUTPUT_DIR / f"frame-{index:03d}.png"
        if not cv2.imwrite(
            str(output_path),
            output,
            [cv2.IMWRITE_PNG_COMPRESSION, 3],
        ):
            raise RuntimeError(f"Could not write {output_path}")

    print(f"source_rotation_degrees={np.degrees(source_angles[-1]):.3f}")
    print(f"output_frames={FRAME_COUNT}")
    print(f"output_duration={FRAME_COUNT / 24:.3f}")
    print(TEXTURE_PATH)


if __name__ == "__main__":
    main()
