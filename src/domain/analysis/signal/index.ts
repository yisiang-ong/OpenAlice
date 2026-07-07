export {
  smaSeries,
  emaSeries,
  rsiSeries,
  atrSeries,
  rvolSeries,
  macdSeries,
  rollingHighest,
  rollingLowest,
  type Series,
  type MacdSeries,
} from './rolling.js'

export {
  detectSignalEvents,
  type DetectBar,
  type SignalSpec,
  type SignalEvent,
  type DetectResult,
} from './detect.js'

export {
  backtestSignal,
  type BacktestSpec,
  type BacktestTrade,
  type BacktestStats,
} from './backtest.js'
