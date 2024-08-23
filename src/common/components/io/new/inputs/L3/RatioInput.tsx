import L2NumberSelect from "common/components/io/new/inputs/L2/L2NumberSelect";
import { RatioInputProps } from "common/components/io/new/inputs/types/Types";
import Ratio, { RatioType } from "common/models/Ratio";
import { useEffect, useState } from "react";

export default function RatioInput(props: RatioInputProps): JSX.Element {
  const [ratio, _] = props.stateHook;
  const [displayedValue, setDisplayedValue] = useState(ratio.magnitude);

  useEffect(() => {
    if (props.optimizedValue !== undefined && props.optimizedValue !== null) {
      setDisplayedValue(props.optimizedValue);
    }
  }, [props.optimizedValue]);

  return (
    <L2NumberSelect
      {...props}
      choices={[RatioType.REDUCTION, RatioType.STEP_UP]}
      fromNumber={(n) => new Ratio(n, ratio.ratioType)}
      makeNumber={(r) => r.magnitude}
      fromString={(s) =>
        new Ratio(
          ratio.magnitude,
          s.toLowerCase() === "reduction"
            ? RatioType.REDUCTION
            : RatioType.STEP_UP,
        )
      }
      makeString={(r) => r.ratioType}
      dangerIf={() => ratio.asNumber() === 0}
    />
  );
}
