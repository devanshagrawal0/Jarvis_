"use strict";

// Run a recipe: the recorded steps for one Instagram action, replayed with NO model call.
//
// This is the whole speed story. The slow, fragile month was Jarvis re-reasoning about the page on
// every run. A recipe is the steps already worked out — find this control, click it, type that,
// check it worked — so replay is deterministic and instant (the tests assert zero AI calls).
//
// Three properties make it safe as well as fast:
//   * Find by MEANING, one match or refuse (element-finder) — never guess between look-alikes.
//   * VERIFY after every action — confirm the expected change is really on the page. Instagram
//     silently soft-fails (rate-limits, no-ops), so a blind "clicked, therefore done" is a lie.
//   * SELF-HEAL on break — when a cached target no longer matches (Instagram shipped a layout
//     change), call the injected heal function ONCE to re-find it, and return the updated recipe so
//     the new target is cached. Only then does a model get involved, and only on a real break.
//
// The driver (the thing that actually touches the browser) and heal (the thing that re-finds via a
// model) are injected, so the whole runner is proven against a fake page with no browser and no AI.

const { findFirst } = require("./element-finder");

function targetsOf(find) {
  return Array.isArray(find) ? find : [find];
}

async function runRecipe(recipe, driver, options = {}) {
  const { heal = null, pacer = null, sleep = async () => {} } = options;
  const stepResults = [];
  const resolvedFinds = new Array(recipe.steps.length); // the target that actually worked, per step
  let aiCalls = 0;

  const cacheableRecipe = () => ({
    ...recipe,
    steps: recipe.steps.map((step, i) => (resolvedFinds[i] ? { ...step, find: resolvedFinds[i] } : step)),
  });
  const done = (ok) => ({ ok, steps: stepResults, aiCalls, recipe: cacheableRecipe() });

  for (let i = 0; i < recipe.steps.length; i += 1) {
    const step = recipe.steps[i];
    const snap = await driver.snapshot();
    const elements = snap.elements || [];

    // 1) Find the control by meaning. If the cached target no longer resolves cleanly, heal once.
    let found = null;
    let workingTarget = null;
    try {
      const r = findFirst(elements, step.find);
      found = r.element;
      workingTarget = r.target;
    } catch (findErr) {
      if (!heal) {
        stepResults.push({ do: step.do, ok: false, code: findErr.code, error: findErr.message });
        return done(false);
      }
      aiCalls += 1;
      const healedTarget = await heal({ step, elements, error: findErr });
      if (!healedTarget) {
        stepResults.push({ do: step.do, ok: false, code: "heal_gave_up", error: findErr.message });
        return done(false);
      }
      try {
        // Prefer the healed target, but keep the originals as fallbacks.
        const r = findFirst(elements, [healedTarget, ...targetsOf(step.find)]);
        found = r.element;
        workingTarget = r.target;
      } catch (afterHealErr) {
        stepResults.push({ do: step.do, ok: false, code: "not_found_after_heal", error: afterHealErr.message });
        return done(false);
      }
    }
    resolvedFinds[i] = workingTarget;

    // 2) Human think-pause before acting (only when a real pacer is supplied; tests pass none).
    if (pacer) await sleep(pacer.thinkPause());

    // 3) Do the step.
    const result = { do: step.do, ok: true, ref: found.ref };
    if (step.do === "click") {
      await driver.click(found.ref);
    } else if (step.do === "type") {
      if (pacer) { for (const d of pacer.typingDelays(step.value)) await sleep(d); }
      await driver.type(found.ref, step.value);
    } else if (step.do === "press") {
      await driver.press(found.ref, step.key);
    } else if (step.do === "read") {
      result.value = found; // a read step just surfaces the element it resolved
    } else {
      stepResults.push({ do: step.do, ok: false, code: "unknown_step", error: `Unknown step "${step.do}"` });
      return done(false);
    }

    // 4) Verify the effect is really on the page. A missing verification is a soft-fail, not success.
    if (step.verify) {
      const after = await driver.snapshot();
      try {
        findFirst(after.elements || [], step.verify);
        result.verified = true;
      } catch (verifyErr) {
        result.ok = false;
        result.verified = false;
        result.code = "verify_failed";
        result.error = verifyErr.message;
        stepResults.push(result);
        return done(false);
      }
    }

    stepResults.push(result);
  }

  return done(true);
}

module.exports = { runRecipe };
