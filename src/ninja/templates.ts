// Starter NinjaScript programs for the editor's "New" menu (written for this project).
export const NEW_NT_STRATEGY = `#region Using declarations
using System;
using System.ComponentModel.DataAnnotations;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
using NinjaTrader.NinjaScript.Indicators;
#endregion

namespace NinjaTrader.NinjaScript.Strategies
{
    public class MyMaCross : Strategy
    {
        private SMA fast;
        private SMA slow;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Description = "Moving-average crossover with stop loss and profit target";
                Name = "MyMaCross";
                Calculate = Calculate.OnBarClose;
                EntriesPerDirection = 1;
                Fast = 10;
                Slow = 25;
                StopTicks = 0;
                TargetTicks = 0;
            }
            else if (State == State.DataLoaded)
            {
                fast = SMA(Fast);
                slow = SMA(Slow);
                AddChartIndicator(fast);
                AddChartIndicator(slow);
                if (StopTicks > 0) SetStopLoss(CalculationMode.Ticks, StopTicks);
                if (TargetTicks > 0) SetProfitTarget(CalculationMode.Ticks, TargetTicks);
            }
        }

        protected override void OnBarUpdate()
        {
            if (CurrentBar < BarsRequiredToTrade) return;
            if (CrossAbove(fast, slow, 1)) EnterLong("Long");
            else if (CrossBelow(fast, slow, 1)) EnterShort("Short");
        }

        [NinjaScriptProperty]
        [Range(1, int.MaxValue)]
        [Display(Name = "Fast", Order = 1, GroupName = "Parameters")]
        public int Fast { get; set; }

        [NinjaScriptProperty]
        [Range(1, int.MaxValue)]
        [Display(Name = "Slow", Order = 2, GroupName = "Parameters")]
        public int Slow { get; set; }

        [NinjaScriptProperty]
        [Range(0, int.MaxValue)]
        [Display(Name = "Stop (ticks)", Order = 3, GroupName = "Risk")]
        public int StopTicks { get; set; }

        [NinjaScriptProperty]
        [Range(0, int.MaxValue)]
        [Display(Name = "Target (ticks)", Order = 4, GroupName = "Risk")]
        public int TargetTicks { get; set; }
    }
}
`;

export const NEW_NT_INDICATOR = `#region Using declarations
using System;
using System.ComponentModel.DataAnnotations;
using System.Windows.Media;
using NinjaTrader.NinjaScript;
#endregion

namespace NinjaTrader.NinjaScript.Indicators
{
    public class MyBands : Indicator
    {
        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Description = "Moving average with standard-deviation bands";
                Name = "MyBands";
                IsOverlay = true;
                Period = 20;
                Width = 2.0;
                AddPlot(Brushes.DodgerBlue, "Middle");
                AddPlot(Brushes.Orange, "Upper");
                AddPlot(Brushes.Orange, "Lower");
            }
        }

        protected override void OnBarUpdate()
        {
            if (CurrentBar < Period) return;
            double mid = SMA(Period)[0];
            double dev = StdDev(Period)[0];
            Middle[0] = mid;
            Upper[0] = mid + Width * dev;
            Lower[0] = mid - Width * dev;
            if (Close[0] > Upper[0]) BarBrush = Brushes.Lime;
            else if (Close[0] < Lower[0]) BarBrush = Brushes.Red;
        }

        public Series<double> Middle { get { return Values[0]; } }
        public Series<double> Upper { get { return Values[1]; } }
        public Series<double> Lower { get { return Values[2]; } }

        [NinjaScriptProperty]
        [Range(2, int.MaxValue)]
        [Display(Name = "Period", Order = 1, GroupName = "Parameters")]
        public int Period { get; set; }

        [NinjaScriptProperty]
        [Range(0.1, double.MaxValue)]
        [Display(Name = "Width", Order = 2, GroupName = "Parameters")]
        public double Width { get; set; }
    }
}
`;
