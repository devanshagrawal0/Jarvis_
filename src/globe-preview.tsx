import { createRoot } from "react-dom/client";
import { JarvisBackground } from "./JarvisBackground";

const root = document.getElementById("root")!;
root.style.cssText = "width:100vw;height:100vh;position:relative;overflow:hidden;";
createRoot(root).render(<JarvisBackground />);
