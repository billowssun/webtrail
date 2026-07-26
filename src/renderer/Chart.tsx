import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import type { EChartsCoreOption as EChartsOption, EChartsType } from "echarts/core";
import { BarChart, HeatmapChart, LineChart, PieChart } from "echarts/charts";
import {
  GraphicComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart, HeatmapChart, LineChart, PieChart,
  GraphicComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent,
  CanvasRenderer
]);

export type ChartClick = {
  name?: string;
  value?: unknown;
  data?: unknown;
  seriesName?: string;
};

export default function Chart({
  option,
  onClick,
  className = ""
}: {
  option: EChartsOption;
  onClick?: (event: ChartClick) => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!host.current) return;
    const chart = echarts.init(host.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    chart.on("click", (event) => clickRef.current?.(event));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
      host.current?.replaceChildren();
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={host} className={`chart ${className}`} role="img" />;
}
