import {
  Bore,
  ChainType,
  FRCVendor,
  MotorBores,
  PulleyBeltType,
} from "common/models/ExtraTypes";
import {
  GearData,
  Gearbox2,
  MotionMethod,
  MotionMethodPart,
  Planetary,
  PulleyData,
  RawPlanetaryData,
  SprocketData,
  Stage2,
} from "common/models/Gearbox";
import amGears from "common/models/data/cots/andymark/gears.json";
import amPulleys from "common/models/data/cots/andymark/pulleys.json";
import amSprockets from "common/models/data/cots/andymark/sprockets.json";
import maxPlanetary from "common/models/data/cots/planetaries/maxplanetaries.json";
import versaPlanetary from "common/models/data/cots/planetaries/versaplanetaries.json";
import revGears from "common/models/data/cots/rev/gears.json";
import revPulleys from "common/models/data/cots/rev/pulleys.json";
import revSprockets from "common/models/data/cots/rev/sprockets.json";
import ttbPulleys from "common/models/data/cots/ttb/pulleys.json";
import ttbSprockets from "common/models/data/cots/ttb/sprockets.json";
import vexGears from "common/models/data/cots/vex/gears.json";
import vexPulleys from "common/models/data/cots/vex/pulleys.json";
import vexSprockets from "common/models/data/cots/vex/sprockets.json";

import cloneDeep from "lodash/cloneDeep";
import max from "lodash/max";
import min from "lodash/min";

import { expose } from "common/tooling/promise-worker";
import { RatioFinderStateV1 } from "web/calculators/ratioFinder";

function stagesFromMinToMax(min: number, max: number): Stage2[] {
  let stages: Stage2[] = [];
  for (let i = min; i <= max; i++) {
    for (let j = min; j <= max; j++) {
      if (i === j) {
        continue;
      }

      stages.push(new Stage2(i, j, [], []));
    }
  }

  return stages;
}

export function allPossibleSingleGearStages(state: RatioFinderStateV1) {
  return stagesFromMinToMax(
    min([state.minGearTeeth, state.minPulleyTeeth, state.minSprocketTeeth]) ||
      8,
    max([state.maxGearTeeth, state.maxPulleyTeeth, state.maxSprocketTeeth]) ||
      80
  );
}

export function allPossiblePlanetaryRatios(planetary: RawPlanetaryData): {
  [ratio: number]: number[][];
} {
  let ret: {
    [ratio: number]: number[][];
  } = {};
  for (let i = 1; i <= planetary.maxStages; i++) {
    [...combinationsWithReplacement(planetary.ratios, i)].forEach((arr) => {
      const ratio = arr.reduce((prev, curr) => prev * curr, 1);
      if (!(ratio in ret)) {
        ret[ratio] = [];
      }
      ret[ratio].push(arr);
    });
  }

  return ret;
}

export function generatePlanetaryStages(planetary: RawPlanetaryData) {
  const ratiosAndStages = allPossiblePlanetaryRatios(planetary);
  let planetaries: Planetary[] = [];
  Object.entries(ratiosAndStages).forEach(([ratio_, stages]) => {
    const ratio = Number(ratio_);
    planetaries.push(new Planetary(ratio, stages, planetary));
  });

  console.log(planetaries);
  return planetaries;
}

export function linkOverlappingGearStages(
  stages: Stage2[],
  motionMethods: MotionMethod[],
  state: RatioFinderStateV1
) {
  motionMethods.forEach((gear) => {
    stages.forEach((stage) => {
      if (gear.teeth === stage.driven && !MotorBores.includes(gear.bore)) {
        stage.drivenMethods.push(gear);
      }

      if (gear.teeth === stage.driving) {
        stage.drivingMethods.push(gear);
      }
    });
  });
}

function filterGears(
  state: RatioFinderStateV1,
  gears: typeof revGears
): GearData[] {
  return gears
    .map((g) => ({
      dp: g.dp,
      bore: g.bore as Bore,
      teeth: g.teeth,
      vendor: g.vendor as FRCVendor,
      partNumber: g.partNumber,
      url: g.url,
    }))
    .filter((g) => state.enable20DPGears || g.dp !== 20)
    .filter((g) => state.enable32DPGears || g.dp !== 32)
    .filter((g) => state.minGearTeeth <= g.teeth)
    .filter((g) => state.maxGearTeeth >= g.teeth);
}

function filterPulleys(
  state: RatioFinderStateV1,
  pulleys: typeof revPulleys
): PulleyData[] {
  return pulleys
    .map((p) => ({
      bore: p.bore as Bore,
      teeth: p.teeth,
      vendor: p.vendor as FRCVendor,
      partNumber: p.partNumber,
      url: p.url,
      pitch: p.pitch,
      beltType: p.type as PulleyBeltType,
    }))
    .filter((p) => state.enableHTD || p.beltType !== "HTD")
    .filter((p) => state.enableGT2 || p.beltType !== "GT2")
    .filter((p) => state.enableRT25 || p.beltType !== "RT25")
    .filter((p) => state.minPulleyTeeth <= p.teeth)
    .filter((p) => state.maxPulleyTeeth >= p.teeth);
}
function filterSprockets(
  state: RatioFinderStateV1,
  sprockets: typeof revSprockets
): SprocketData[] {
  return sprockets
    .map((s) => ({
      bore: s.bore as Bore,
      teeth: s.teeth,
      vendor: s.vendor as FRCVendor,
      partNumber: s.partNumber,
      url: s.url,
      chainType: s.type as ChainType,
    }))
    .filter((s) => state.enable25Chain || s.chainType !== "#25")
    .filter((s) => state.enable35Chain || s.chainType !== "#35")
    .filter((s) => state.minSprocketTeeth <= s.teeth)
    .filter((s) => state.maxSprocketTeeth >= s.teeth);
}

export function generateOptions(state: RatioFinderStateV1) {
  let stages = allPossibleSingleGearStages(state);

  if (state.enableMPs && state.enableREV) {
    stages = stages.concat(
      generatePlanetaryStages({
        inputs: maxPlanetary.inputs as Bore[],
        maxStages: maxPlanetary.maxStages,
        outputs: maxPlanetary.outputs as Bore[],
        partNumber: maxPlanetary.partNumber,
        ratios: maxPlanetary.ratios,
        url: maxPlanetary.url,
        vendor: maxPlanetary.vendor as FRCVendor,
      })
    );
  }
  if (state.enableVPs && state.enableVEX) {
    stages = stages.concat(
      generatePlanetaryStages({
        inputs: versaPlanetary.inputs as Bore[],
        maxStages: versaPlanetary.maxStages,
        outputs: versaPlanetary.outputs as Bore[],
        partNumber: versaPlanetary.partNumber,
        ratios: versaPlanetary.ratios,
        url: versaPlanetary.url,
        vendor: versaPlanetary.vendor as FRCVendor,
      })
    );
  }

  let gears = [
    ...(state.enableREV ? revGears : []),
    ...(state.enableAM ? amGears : []),
    ...(state.enableWCP ? [] : []),
    ...(state.enableTTB ? [] : []),
    ...(state.enableVEX ? vexGears : []),
  ];

  let pulleys = [
    ...(state.enableREV ? revPulleys : []),
    ...(state.enableAM ? amPulleys : []),
    ...(state.enableWCP ? [] : []),
    ...(state.enableTTB ? ttbPulleys : []),
    ...(state.enableVEX ? vexPulleys : []),
  ];

  let sprockets = [
    ...(state.enableREV ? revSprockets : []),
    ...(state.enableAM ? amSprockets : []),
    ...(state.enableWCP ? [] : []),
    ...(state.enableTTB ? ttbSprockets : []),
    ...(state.enableVEX ? vexSprockets : []),
  ];

  let motionMethods: MotionMethod[] = [
    ...filterGears(state, gears).map((g) => ({
      ...g,
      type: "Gear" as MotionMethodPart,
    })),
    ...filterPulleys(state, pulleys).map((g) => ({
      ...g,
      type: "Pulley" as MotionMethodPart,
    })),
    ...filterSprockets(state, sprockets).map((g) => ({
      ...g,
      type: "Sprocket" as MotionMethodPart,
    })),
  ]
    .filter((m) => state.enableREV || m.vendor !== "REV")
    .filter((m) => state.enableAM || m.vendor !== "AndyMark")
    .filter((m) => state.enableVEX || m.vendor !== "VEXpro")
    .filter((m) => state.enableWCP || m.vendor !== "WCP")
    .filter((m) => state.enableTTB || m.vendor !== "TTB")
    .filter((m) => {
      let good = true;
      if (MotorBores.includes(m.bore)) {
        good = good && (state.enableFalconPinions || m.bore !== "Falcon");
        good = good && (state.enableNEOPinions || m.bore !== "NEO");
        good = good && (state.enable775Pinions || m.bore !== "775");
        good = good && (state.enable550Pinions || m.bore !== "550");
      } else {
        good = good && (state.enable12HexBore || m.bore !== "1/2 Hex");
        good = good && (state.enable38HexBore || m.bore !== "3/8 Hex");
        good = good && (state.enable875Bore || m.bore !== "0.875in");
        good = good && (state.enableBearingBore || m.bore !== "1.125in");
        good = good && (state.enableMaxSpline || m.bore !== "MAXSpline");
      }
      return good;
    });

  linkOverlappingGearStages(stages, motionMethods, state);

  stages = stages
    .filter((stage) => stage.drivenMethods.length > 0)
    .filter((stage) => stage.drivingMethods.length > 0);

  let options: Gearbox2[] = [];
  for (let i = state.minStages; i <= state.maxStages; i++) {
    let gbs: Gearbox2[] = [];

    var iter = permutations(stages, i);
    var curr = iter.next();

    while (!curr.done) {
      const gb = new Gearbox2(curr.value);
      const ratio = gb.getRatio();

      if (
        ratio >= state.targetReduction - state.reductionError &&
        ratio <= state.targetReduction + state.reductionError
      ) {
        const newStages = cloneDeep(curr.value);
        gb.stages = newStages;
        gb.filterStagesForOverlappingMotionMethods();
        gb.filterStagesForOverlappingBores();
        gb.filterStagesForOverlappingMotionMethods();

        let good = true;
        if (state.firstPartPinion) {
          good = gb.containsPinionInGoodPlace();
        } else {
          good = !gb.containsPinionInGoodPlace();
        }

        if (gb.hasMotionModes() && good && !gb.containsPinionInBadPlace()) {
          gbs.push(gb);
        }
      }

      curr = iter.next();
    }

    options = options.concat(gbs);
  }

  return options.map((gb) => gb.toObj());
}

const workerFunctions = { generateOptions };
expose(workerFunctions);
type RatioFinderWorkerFunctions = typeof workerFunctions;
export type { RatioFinderWorkerFunctions };

function* permutations<T>(array: T[], r: number) {
  // Algorythm copied from Python `itertools.permutations`.
  var n = array.length;
  if (r === undefined) {
    r = n;
  }
  if (r > n) {
    return;
  }
  var indices = [];
  for (var i = 0; i < n; i++) {
    indices.push(i);
  }
  var cycles = [];
  for (var i = n; i > n - r; i--) {
    cycles.push(i);
  }
  var results = [];
  var res = [];
  for (var k = 0; k < r; k++) {
    res.push(array[indices[k]]);
  }
  yield res;
  // results.push(res);

  var broken = false;
  while (n > 0) {
    for (var i = r - 1; i >= 0; i--) {
      cycles[i]--;
      if (cycles[i] === 0) {
        indices = indices
          .slice(0, i)
          .concat(indices.slice(i + 1).concat(indices.slice(i, i + 1)));
        cycles[i] = n - i;
        broken = false;
      } else {
        var j = cycles[i];
        var x = indices[i];
        indices[i] = indices[n - j];
        indices[n - j] = x;
        var res = [];
        for (var k = 0; k < r; k++) {
          res.push(array[indices[k]]);
        }
        // results.push(res);
        yield res;
        broken = true;
        break;
      }
    }
    if (broken === false) {
      break;
    }
  }

  return;
}

export function* combinationsWithReplacement<T>(
  iterable: Iterable<T>,
  r: number
): Generator<T[]> {
  if (!Number.isInteger(r) || r < 0) {
    throw RangeError("r must be a non-negative integer");
  }
  const pool = [...iterable];
  const n = pool.length;
  if (n === 0 && r > 0) {
    return;
  }
  const indices = new Uint32Array(r);
  yield Array(r).fill(pool[0]);
  while (true) {
    let i: number;
    loop: {
      for (i = r - 1; i >= 0; i--) {
        if (indices[i] !== n - 1) {
          break loop;
        }
      }
      return;
    }
    const result: T[] = Array(r);
    for (let j = 0; j < i; j++) {
      result[j] = pool[indices[j]];
    }
    const index = indices[i] + 1;
    const element = pool[index];
    for (let j = i; j < r; j++) {
      indices[j] = index;
      result[j] = element;
    }
    yield result;
  }
}
