@echo off
title Friends in Voice installer
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://friendsinvoice.sarhsoft.com/install.ps1 | iex"
pause
