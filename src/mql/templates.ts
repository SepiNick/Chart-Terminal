// Starter programs for the editor's "New" menu (written for this project).
export const NEW_MQL5_EA = `//+------------------------------------------------------------------+
//| Moving-average crossover expert (MQL5)                           |
//+------------------------------------------------------------------+
#property strict
#include <Trade\\Trade.mqh>

input int    FastPeriod = 9;      // Fast MA period
input int    SlowPeriod = 21;     // Slow MA period
input double Lots       = 0.01;   // Volume
input int    StopLossPts   = 0;   // Stop loss (points, 0 = none)
input int    TakeProfitPts = 0;   // Take profit (points, 0 = none)
input ulong  Magic      = 2026;

CTrade trade;
int fastHandle, slowHandle;

int OnInit()
{
   fastHandle = iMA(_Symbol, PERIOD_CURRENT, FastPeriod, 0, MODE_EMA, PRICE_CLOSE);
   slowHandle = iMA(_Symbol, PERIOD_CURRENT, SlowPeriod, 0, MODE_EMA, PRICE_CLOSE);
   if(fastHandle == INVALID_HANDLE || slowHandle == INVALID_HANDLE) return INIT_FAILED;
   trade.SetExpertMagicNumber(Magic);
   return INIT_SUCCEEDED;
}

void OnTick()
{
   double fast[], slow[];
   ArraySetAsSeries(fast, true);
   ArraySetAsSeries(slow, true);
   if(CopyBuffer(fastHandle, 0, 1, 2, fast) < 2 || CopyBuffer(slowHandle, 0, 1, 2, slow) < 2) return;
   bool crossUp   = fast[1] <= slow[1] && fast[0] > slow[0];
   bool crossDown = fast[1] >= slow[1] && fast[0] < slow[0];
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(crossUp)
   {
      if(PositionSelect(_Symbol) && PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) trade.PositionClose(_Symbol);
      if(!PositionSelect(_Symbol))
         trade.Buy(Lots, _Symbol, ask, StopLossPts ? ask - StopLossPts * _Point : 0, TakeProfitPts ? ask + TakeProfitPts * _Point : 0);
   }
   if(crossDown)
   {
      if(PositionSelect(_Symbol) && PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) trade.PositionClose(_Symbol);
      if(!PositionSelect(_Symbol))
         trade.Sell(Lots, _Symbol, bid, StopLossPts ? bid + StopLossPts * _Point : 0, TakeProfitPts ? bid - TakeProfitPts * _Point : 0);
   }
}
`;

export const NEW_MQL5_INDICATOR = `//+------------------------------------------------------------------+
//| Two moving averages (MQL5 indicator)                             |
//+------------------------------------------------------------------+
#property indicator_chart_window
#property indicator_buffers 2
#property indicator_plots   2
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrOrange
#property indicator_label1  "Fast"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrDodgerBlue
#property indicator_label2  "Slow"

input int FastPeriod = 9;
input int SlowPeriod = 21;

double FastBuf[], SlowBuf[];

int OnInit()
{
   SetIndexBuffer(0, FastBuf, INDICATOR_DATA);
   SetIndexBuffer(1, SlowBuf, INDICATOR_DATA);
   IndicatorSetString(INDICATOR_SHORTNAME, "MA(" + IntegerToString(FastPeriod) + "," + IntegerToString(SlowPeriod) + ")");
   return INIT_SUCCEEDED;
}

int OnCalculate(const int rates_total, const int prev_calculated, const int begin, const double &price[])
{
   double kf = 2.0 / (FastPeriod + 1), ks = 2.0 / (SlowPeriod + 1);
   int start = prev_calculated > 0 ? prev_calculated - 1 : 0;
   for(int i = start; i < rates_total; i++)
   {
      if(i == 0) { FastBuf[i] = price[i]; SlowBuf[i] = price[i]; continue; }
      FastBuf[i] = price[i] * kf + FastBuf[i - 1] * (1 - kf);
      SlowBuf[i] = price[i] * ks + SlowBuf[i - 1] * (1 - ks);
   }
   return rates_total;
}
`;

export const NEW_MQL4_EA = `//+------------------------------------------------------------------+
//| RSI reversal expert (MQL4)                                        |
//+------------------------------------------------------------------+
#property strict

extern int    RsiPeriod  = 14;
extern double Oversold   = 30;
extern double Overbought = 70;
extern double Lots       = 0.01;
extern int    StopLoss   = 0;    // points
extern int    TakeProfit = 0;    // points
extern int    Magic      = 4040;

int OnInit() { return INIT_SUCCEEDED; }

int CountOrders(int type)
{
   int n = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderMagicNumber() == Magic && OrderType() == type) n++;
   return n;
}

void CloseAll(int type)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderMagicNumber() == Magic && OrderType() == type)
         OrderClose(OrderTicket(), OrderLots(), type == OP_BUY ? Bid : Ask, 3, clrNONE);
}

void OnTick()
{
   double prev = iRSI(NULL, 0, RsiPeriod, PRICE_CLOSE, 2);
   double curr = iRSI(NULL, 0, RsiPeriod, PRICE_CLOSE, 1);
   if(prev < Oversold && curr >= Oversold && CountOrders(OP_BUY) == 0)
   {
      CloseAll(OP_SELL);
      OrderSend(Symbol(), OP_BUY, Lots, Ask, 3, StopLoss ? Ask - StopLoss * Point : 0, TakeProfit ? Ask + TakeProfit * Point : 0, "RSI buy", Magic, 0, clrBlue);
   }
   if(prev > Overbought && curr <= Overbought && CountOrders(OP_SELL) == 0)
   {
      CloseAll(OP_BUY);
      OrderSend(Symbol(), OP_SELL, Lots, Bid, 3, StopLoss ? Bid + StopLoss * Point : 0, TakeProfit ? Bid - TakeProfit * Point : 0, "RSI sell", Magic, 0, clrRed);
   }
}
`;
