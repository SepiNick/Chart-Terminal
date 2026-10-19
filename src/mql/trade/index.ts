// Trade runtime: broker emulator + MQL4/MQL5 trade API + MQL5 Standard Library trade classes.
import type { Install, OutParams } from '../contract.ts';
import { MtBroker } from './broker.ts';
import { installClasses } from './classes.ts';
import { ACCOUNT_CONST, ERR4, MQL4_CONST, MQL5_CONST, def } from './constants.ts';
import { installMql4 } from './mql4.ts';
import { installAccount, installMql5 } from './mql5.ts';

export { MtBroker };

export const installTrade: Install = (rt, env) => {
  const b = new MtBroker(env);
  rt.__broker = b;
  def(rt, ACCOUNT_CONST);
  installAccount(rt, b, env);
  if (env.dialect === 'mql4') { def(rt, MQL4_CONST); def(rt, ERR4); installMql4(rt, b, env) }
  else { def(rt, MQL5_CONST); installClasses(rt, b, env, installMql5(rt, b, env)) }
};

const out = (names: string[], arity: number, idx: number) => Object.fromEntries(names.map(n => [`${n}/${arity}`, [idx]]));
export const TRADE_OUT_PARAMS: OutParams = {
  ...out(['PositionGetDouble', 'PositionGetInteger', 'PositionGetString', 'OrderGetDouble', 'OrderGetInteger', 'OrderGetString'], 2, 1),
  ...out(['HistoryOrderGetDouble', 'HistoryOrderGetInteger', 'HistoryOrderGetString', 'HistoryDealGetDouble', 'HistoryDealGetInteger', 'HistoryDealGetString'], 3, 2),
  'OrderCalcMargin/5': [4], 'OrderCalcProfit/6': [5],
};
export const TRADE_STRUCTS = ['MqlTradeRequest', 'MqlTradeResult', 'MqlTradeCheckResult', 'MqlTradeTransaction'];
export const TRADE_CLASSES = ['CTrade', 'CPositionInfo', 'COrderInfo', 'CDealInfo', 'CHistoryOrderInfo', 'CSymbolInfo', 'CAccountInfo'];
export const TRADE_INCLUDES = ['Trade\\Trade.mqh', 'Trade\\PositionInfo.mqh', 'Trade\\OrderInfo.mqh', 'Trade\\DealInfo.mqh', 'Trade\\SymbolInfo.mqh', 'Trade\\AccountInfo.mqh', 'Trade\\HistoryOrderInfo.mqh'];
