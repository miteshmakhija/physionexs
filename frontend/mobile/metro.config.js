// Learn more https://docs.expo.io/guides/customizing-metro
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// Allow importing design tokens and API types from frontend/shared (outside the project root).
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../shared')]

module.exports = config
