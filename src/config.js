// SetPilot — central config.
// The app name lives here so renaming later is a one-line change.

export const APP_NAME = "SetPilot";

// AbletonOSC networking.
// AbletonOSC listens for commands on 11000 and sends replies/updates to 11001.
// These are AbletonOSC's defaults; only change them if you've reconfigured it.
export const OSC = {
  host: "127.0.0.1",
  remotePort: 11000, // we send commands here (AbletonOSC's listen port)
  localPort: 11001, // we listen here (AbletonOSC's reply port)
};
