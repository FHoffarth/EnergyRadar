# Changelog

Notable changes to EnergyRadar are documented in this file.

## [0.5.3] - 2026-07-18

### Windows Download Fix

Resolved a Windows-specific startup issue affecting release archives downloaded
through a web browser.

Windows Mark-of-the-Web metadata prevented .NET from loading the bundled
`Python.Runtime` assemblies. The Windows package now includes the required
runtime configuration, and the release pipeline validates packaged runtime
files under equivalent download security conditions before publishing.

This release completes the EnergyRadar v0.5 experience and distribution
foundation.
