import { HologramGlobe } from "../components/hologram/HologramGlobe";
import styles from "../components/hologram/HologramGlobe/HologramGlobe.module.css";

export function HologramGlobeDemo() {
  const params = new URLSearchParams(window.location.search);
  const paused = params.has("paused");
  const requestedSpeed = Number(params.get("speed"));
  const speedMultiplier = Number.isFinite(requestedSpeed) && requestedSpeed > 0
    ? requestedSpeed
    : 1;

  return (
    <main className={styles.demo}>
      <HologramGlobe
        paused={paused}
        rotationSpeed={0.038 * speedMultiplier}
      />
    </main>
  );
}
