import Graph from "common/components/graphing/Graph";
import { GraphConfig } from "common/components/graphing/graphConfig";
import SimpleHeading from "common/components/heading/SimpleHeading";
import PistonInput from "common/components/io/inputs/PistonInput";
import SingleInputLine from "common/components/io/inputs/SingleInputLine";
import CompressorInput from "common/components/io/new/inputs/L3/CompressorInput";
import MeasurementInput from "common/components/io/new/inputs/L3/MeasurementInput";
import NumericOutput from "common/components/io/outputs/NumberOutput";
import { Button, Column, Columns } from "common/components/styling/Building";
import Measurement from "common/models/Measurement";
import Piston from "common/models/Piston";
import PistonList, { getNumberFromPistonName } from "common/models/PistonList";
import { useGettersSetters } from "common/tooling/conversion";
import { wrap } from "common/tooling/promise-worker";
import { NoOp, getRandomInteger } from "common/tooling/util";
import { useEffect, useState } from "react";
import usePromise from "react-use-promise";
import {
  PneumaticsParamsV1,
  PneumaticsStateV1,
  pneumaticsGraphConfig,
} from "web/calculators/pneumatics";
import { PneumaticsState } from "web/calculators/pneumatics/converter";
import {
  PneumaticWorkerFunctions,
  generatePressureTimeline,
} from "web/calculators/pneumatics/math";
import rawWorker from "web/calculators/pneumatics/math?worker";
import {
  calculateArmStates,
  optimizeReduction,
} from "web/calculators/arm/armMath";
import {
  ArmParamsV1,
  ArmStateV1,
} from "web/calculators/arm";
import {
  MotorInput,
  RatioInput,
  NumberInput,
  MeasurementOutput,
} from "common/components/io/new/inputs";
import { useAsyncMemo } from "common/hooks/useAsyncMemo";
import { useMemo } from "react";
import { ArmState } from "web/calculators/arm/converter";
import KgKvKaDisplay from "web/calculators/shared/components/KgKvKaDisplay";
import {
  calculateKa,
  calculateKg,
  calculateKv,
} from "web/calculators/shared/sharedMath";

const worker = await wrap<PneumaticWorkerFunctions>(new rawWorker());

const defaultPiston = (pl: PistonList) => {
  const maxFound = Math.max(
    ...pl.pistons.map((p) => getNumberFromPistonName(p.identifier)),
  );
  const n = [-Infinity, Infinity, NaN].includes(maxFound) ? 1 : maxFound + 1;

  return new Piston(
    `Piston ${n}`,
    1,
    new Measurement(getRandomInteger(1, 6) / 2, "in"),
    new Measurement(getRandomInteger(1, 12) / 16, "in"),
    new Measurement(getRandomInteger(1, 12), "in"),
    new Measurement(getRandomInteger(15, 60), "psi"),
    new Measurement(getRandomInteger(15, 60), "psi"),
    true,
    new Measurement(getRandomInteger(4, 16), "s"),
  );
};

export default function PneumaticsCalculator(): JSX.Element {
  const [get, set] = useGettersSetters(
    PneumaticsState.getState() as PneumaticsStateV1,
  );

  const calculate = {
    timelineAndDutyCycle: () =>
      generatePressureTimeline(get.pistons, get.tankVolume, get.compressor),
    timeline: () => timelineAndDutyCycle.timeline,
    dutyCycle: () => timelineAndDutyCycle.dutyCycle,
    recommendedTanks: () =>
      worker.getRecommendedTanks(get.pistons.toDict(), get.compressor.toDict()),
  };

  const [timelineAndDutyCycle, setTimelineAndDutyCycle] = useState(
    calculate.timelineAndDutyCycle(),
  );
  const [timeline, setTimeline] = useState(calculate.timeline());
  const [dutyCycle, setDutyCycle] = useState(calculate.dutyCycle());
  const [recommendedTanks, _error, _state] = usePromise(
    calculate.recommendedTanks,
    [get.pistons.pistons, get.compressor],
  );

  useEffect(() => {
    setTimelineAndDutyCycle(calculate.timelineAndDutyCycle());
  }, [get.pistons, get.tankVolume, get.compressor]);

  useEffect(() => {
    setTimeline(calculate.timeline());
    setDutyCycle(calculate.dutyCycle());
  }, [timelineAndDutyCycle]);

  const [optimalReduction, setOptimalReduction] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(true);

  const states = useAsyncMemo(
    [] as MomentaryArmState[],
    async () => {
      setIsCalculating(true);
      const states = await worker.calculateArmStates(
        get.motor.toDict(),
        get.ratio.toDict(),
        get.comLength.toDict(),
        get.armMass.toDict(),
        get.currentLimit.toDict(),
        get.startAngle.toDict(),
        get.endAngle.toDict(),
        get.efficiency,
        get.iterationLimit,
      );
      setIsCalculating(false);
      return states;
    },
    [
      get.motor,
      get.ratio,
      get.comLength,
      get.armMass,
      get.currentLimit,
      get.startAngle,
      get.endAngle,
      get.efficiency,
      get.iterationLimit,
    ],
  );

  const timeToGoal = useMemo(
    () =>
      states.length > 0
        ? Measurement.fromDict(states[states.length - 1].time)
        : new Measurement(0, "s"),
    [states],
  );

  const kG = useMemo(
    () =>
      calculateKg(
        get.motor.stallTorque.mul(get.motor.quantity).mul(get.ratio.asNumber()),
        get.comLength,
        get.armMass.mul(get.efficiency / 100),
      ),
    [
      get.motor.stallTorque,
      get.motor.quantity,
      get.ratio,
      get.comLength,
      get.armMass,
      get.efficiency,
    ],
  );

  const kV = useMemo(() => {
    if (get.ratio.asNumber() == 0) {
      return new Measurement(0, "V*s/rad");
    }

    return calculateKv(
      get.motor.freeSpeed.div(get.ratio.asNumber()),
      new Measurement(1, "rad"),
    );
  }, [get.motor.freeSpeed, get.ratio]);

  const kA = useMemo(
    () =>
      calculateKa(
        get.motor.stallTorque
          .mul(get.motor.quantity)
          .mul(get.ratio.asNumber())
          .mul(get.efficiency / 100),
        get.comLength.mul(get.comLength).div(new Measurement(1, "rad")),
        get.armMass,
      ),
    [
      get.motor.stallTorque,
      get.motor.quantity,
      get.ratio,
      get.efficiency,
      get.comLength,
      get.armMass,
    ],
  );

  const handleOptimize = async () => {
    setIsCalculating(true);
    let bestReduction = 0;
    let bestTimeToGoal = new Measurement(Infinity, "s");

    for (let reduction = 1; reduction <= 100; reduction++) {
      const states = await worker.calculateArmStates(
        get.motor.toDict(),
        { ...get.ratio.toDict(), magnitude: reduction },
        get.comLength.toDict(),
        get.armMass.toDict(),
        get.currentLimit.toDict(),
        get.startAngle.toDict(),
        get.endAngle.toDict(),
        get.efficiency,
        get.iterationLimit,
      );

      const timeToGoal = states.length > 0
        ? Measurement.fromDict(states[states.length - 1].time)
        : new Measurement(Infinity, "s");

      if (timeToGoal.lt(bestTimeToGoal)) {
        bestTimeToGoal = timeToGoal;
        bestReduction = reduction;
      }
    }

    setOptimalReduction(bestReduction);
    set.setRatio(new Ratio(bestReduction, RatioType.REDUCTION));
    setIsCalculating(false);
  };

  return (
    <>
      <SimpleHeading
        queryParams={PneumaticsParamsV1}
        state={get}
        title="Pneumatics Calculator"
      />
      <Graph
        options={pneumaticsGraphConfig}
        simpleDatasets={[
          GraphConfig.dataset("System Pressure (psi)", timeline, 0, "y"),
        ]}
        title="System Pressure Over Time"
        id="pneumaticsGraph"
      />
      <Columns multiline centered>
        <Column narrow>
          <Button
            color={"primary"}
            onClick={() => {
              set.setPistons(
                get.pistons.copyAndAdd(defaultPiston(get.pistons)),
              );
            }}
            faIcon="plus"
          >
            Add Cylinder
          </Button>
        </Column>
        <Column>
          <SingleInputLine
            label="Tank Volume"
            id="tankVolumeInput"
            tooltip="The total volume of pneumatic tanks on the robot. The most common size is 574mL."
          >
            <MeasurementInput stateHook={[get.tankVolume, set.setTankVolume]} />
          </SingleInputLine>
        </Column>
        <Column narrow>
          <SingleInputLine
            label="Compressor"
            id="compressor"
            tooltip="The compressor powering the system."
          >
            <CompressorInput stateHook={[get.compressor, set.setCompressor]} />
          </SingleInputLine>
        </Column>
        <Column narrow>
          <SingleInputLine
            label="Compressor Duty Cycle (%)"
            id="dutyCycleOutput"
            tooltip="How often the compressor is running during a match."
          >
            <NumericOutput stateHook={[dutyCycle, setDutyCycle]} roundTo={2} />
          </SingleInputLine>
        </Column>
        <Column narrow>
          <SingleInputLine
            label="Recommended KOP Tanks"
            id="recommendedTanks"
            tooltip="The number of 574mL tanks required to not drop below 20psi during a match."
          >
            <NumericOutput
              stateHook={[recommendedTanks || 0, NoOp]}
              loadingIf={() => [0, undefined].includes(recommendedTanks)}
              roundTo={0}
            />
          </SingleInputLine>
        </Column>
      </Columns>

      <Columns multiline centered>
        {get.pistons.pistons.map((p) => (
          <Column ofTwelve={4} key={`Column-${p.identifier}`}>
            <PistonInput
              piston={p}
              name={p.identifier}
              removeFn={() => set.setPistons(get.pistons.copyAndRemove(p))}
              stateHook={[get.pistons, set.setPistons]}
            />
          </Column>
        ))}
      </Columns>

      <Columns>
        <Column>
          <SingleInputLine
            label="Motor"
            id="motor"
            tooltip="Motors powering the arm."
          >
            <MotorInput stateHook={[get.motor, set.setMotor]} />
          </SingleInputLine>
          <SingleInputLine
            label="Ratio"
            id="ratio"
            tooltip="Ratio of the gearbox."
          >
            <RatioInput stateHook={[get.ratio, set.setRatio]} />
          </SingleInputLine>
          <SingleInputLine
            label="Efficiency (%)"
            id="efficiency"
            tooltip="The efficiency of the system in transmitting torque from the motors."
          >
            <NumberInput
              stateHook={[get.efficiency, set.setEfficiency]}
              delay={0.5}
            />
          </SingleInputLine>
          <SingleInputLine
            label="Current Limit"
            id="currentLimit"
            tooltip="Stator current limit applied to each motor."
          >
            <MeasurementInput
              stateHook={[get.currentLimit, set.setCurrentLimit]}
            />
          </SingleInputLine>
          <SingleInputLine
            label="CoM Distance"
            id="comLength"
            tooltip={
              <>
                Distance of the center of mass
                <br />
                from the rotation point.
              </>
            }
          >
            <MeasurementInput
              stateHook={[get.comLength, set.setComLength]}
              numberDelay={0.5}
            />
          </SingleInputLine>
          <SingleInputLine
            label="Arm Mass"
            id="armMass"
            tooltip={
              <>
                Mass of the arm measured
                <br /> at the center of mass.
              </>
            }
          >
            <MeasurementInput
              stateHook={[get.armMass, set.setArmMass]}
              numberDelay={0.5}
            />
          </SingleInputLine>
          <SingleInputLine
            label="Start Angle"
            id="startAngle"
            tooltip={
              <>
                Starting angle of the arm.
                <br />
                Must be less than end angle.
              </>
            }
          >
            <MeasurementInput
              stateHook={[get.startAngle, set.setStartAngle]}
              numberDelay={0.5}
            />
          </SingleInputLine>
          <SingleInputLine
            label="End Angle"
            id="endAngle"
            tooltip={
              <>
                Ending angle of the arm.
                <br />
                Must be greater than start angle.
              </>
            }
          >
            <MeasurementInput
              stateHook={[get.endAngle, set.setEndAngle]}
              numberDelay={0.5}
            />
          </SingleInputLine>
          <SingleInputLine
            label="Iteration Limit"
            id="iterationLimit"
            tooltip="Number of time-cycles to simulate."
          >
            <NumberInput
              stateHook={[get.iterationLimit, set.setIterationLimit]}
              delay={0.5}
            />
          </SingleInputLine>

          <SingleInputLine
            label="Time To Goal"
            id="timeToGoal"
            tooltip="Time from start angle to end angle."
          >
            <MeasurementOutput
              stateHook={[timeToGoal, () => undefined]}
              numberRoundTo={3}
              loadingIf={() => isCalculating}
            />
          </SingleInputLine>
          <KgKvKaDisplay kG={kG} kV={kV} kA={kA} distanceType={"angular"} />
          <Button onClick={handleOptimize} disabled={isCalculating}>
            Optimize
          </Button>
          {optimalReduction !== null && (
            <Message color="info">
              Optimal Reduction: {optimalReduction}
            </Message>
          )}
        </Column>
      </Columns>
    </>
  );
}
