import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

ApplicationWindow {
    id: window
    title: "EnergyRadar"
    minimumWidth: 420
    minimumHeight: 640
    visible: true

    // ---------------------------------------------------------------- //
    // Design-Tokens – einziger Ort für alle Farben, Abstände, Radien   //
    // ---------------------------------------------------------------- //
    QtObject {
        id: theme

        // Basis-Palette
        readonly property bool dark: uiSettings.theme !== "light"
        readonly property color bg:           dark ? "#07111E" : "#F4F1EB"
        readonly property color surface:      dark ? "#0D1C2B" : "#FFFFFF"
        readonly property color surfaceHigh:  dark ? "#152535" : "#F0EDE7"
        readonly property color border:       dark ? "#1E3048" : "#DDD8CE"
        readonly property color text:         dark ? "#E6EDF3" : "#1E2B35"
        readonly property color textMuted:    dark ? "#7A8FA0" : "#6B7A87"
        readonly property color textDisabled: dark ? "#3A5068" : "#BCBCBC"

        // Akzentfarbe (Amber)
        readonly property color accent:       dark ? "#F5B301" : "#C88F00"
        readonly property color accentFaded:  dark ? "#2A2210" : "#FFF3CC"

        // Semantische Farben
        readonly property color positive:     dark ? "#4FC58A" : "#2A9E64"
        readonly property color negative:     dark ? "#E07060" : "#C04030"
        readonly property color warning:      dark ? "#E8A930" : "#B57800"
        readonly property color neutral:      dark ? "#7A8FA0" : "#6B7A87"

        // Geometrie
        readonly property int radiusCard:     16
        readonly property int radiusInner:    10
        readonly property int radiusPill:     999
        readonly property int spacingXS:      6
        readonly property int spacingS:       10
        readonly property int spacingM:       16
        readonly property int spacingL:       24
        readonly property int spacingXL:      32

        // Typografie
        readonly property string fontFamily:  Qt.platform.os === "windows"
                                              ? "Segoe UI" : "SF Pro Display"
        readonly property int fontSizeVerdict:  26
        readonly property int fontSizeValue:    24
        readonly property int fontSizeBody:     15
        readonly property int fontSizeSmall:    13
        readonly property int fontSizeLabel:    11
    }

    // ---------------------------------------------------------------- //
    // Strings – zentrales Wörterbuch (alle DE-Texte)                   //
    // ---------------------------------------------------------------- //
    QtObject {
        id: str
        // Tabs
        readonly property string tabNow:        "Jetzt"
        readonly property string tabToday:      "Heute"
        readonly property string tabDevices:    "Geräte"
        readonly property string tabSettings:   "Einstellungen"

        // Jetzt-Screen
        readonly property string labelPv:          "Solarleistung"
        readonly property string labelGrid:        "Netz"
        readonly property string labelConsumption: "Verbrauch"
        readonly property string labelUnknown:     "–"
        readonly property string unitW:            "W"
        readonly property string unitKw:           "kW"
        readonly property string unitKwh:          "kWh"
        readonly property string pinLockBanner:    "Der Netzzähler ist noch nicht PIN-entsperrt. Bitte aktiviere ihn zuerst."
        readonly property string noSourceCta:      "In den Einstellungen einrichten"

        // Heute-Screen
        readonly property string todayGenerated:   "Heute erzeugt"
        readonly property string todayImport:      "Netzbezug gesamt"
        readonly property string todayExport:      "Einspeisung gesamt"
        readonly property string todayChartTitle:  "Solarleistung heute"
        readonly property string todayNoHistory:   "Noch keine Daten für heute aufgezeichnet."
        readonly property string todayNoSource:    "Keine Datenquelle eingerichtet."

        // Geräte-Screen
        readonly property string devicesTitle:       "Geräte & Datenqualität"
        readonly property string deviceFronius:      "Fronius Wechselrichter"
        readonly property string deviceMt175:        "Stromzähler (MT175)"
        readonly property string statusConnected:    "Verbunden"
        readonly property string statusUnavailable:  "Nicht erreichbar"
        readonly property string statusError:        "Fehler"
        readonly property string statusUnconfigured: "Nicht eingerichtet"
        readonly property string deviceLastNever:    "Noch nie verbunden"
        readonly property string deviceTestBtn:      "Testen"
        readonly property string deviceTesting:      "Wird getestet …"
        readonly property string deviceTestOk:       "Erreichbar ✓"
        readonly property string deviceTestFail:     "Nicht erreichbar"

        // Einstellungen-Screen
        readonly property string settingsTitle:         "Einstellungen"
        readonly property string settingsFroniusLabel:  "Fronius-Adresse"
        readonly property string settingsFroniusHint:   "z. B. fronius.local oder 192.168.1.x"
        readonly property string settingsMt175Label:    "Stromzähler-Adresse"
        readonly property string settingsMt175Hint:     "HTTP-Adresse des Tasmota-Lesegeräts"
        readonly property string settingsRefresh:       "Aktualisierung alle"
        readonly property string settingsSeconds:       "Sek."
        readonly property string settingsTheme:         "Darstellung"
        readonly property string settingsThemeDark:     "Dunkel"
        readonly property string settingsThemeLight:    "Hell"
        readonly property string settingsThemeSystem:   "System"
        readonly property string settingsSave:          "Speichern"
        readonly property string settingsTest:          "Verbindung testen"
        readonly property string settingsSavedOk:       "Gespeichert ✓"
        readonly property string settingsSaveError:     "Fehler beim Speichern"
        readonly property string settingsTestOk:        "Gerät erreichbar ✓"
        readonly property string settingsTestFail:      "Gerät nicht erreichbar"
        readonly property string settingsInvalidAddr:   "Ungültige Adresse – nur lokale Netzadressen erlaubt."
        readonly property string settingsSectionDevices: "Geräte"
        readonly property string settingsSectionData:   "Daten"
        readonly property string settingsSectionDisplay: "Darstellung"
    }

    // ---------------------------------------------------------------- //
    // Geparste Daten aus der Bridge                                     //
    // ---------------------------------------------------------------- //
    property var nowVm:      ({})
    property var todayVm:    ({})
    property var devicesVm:  ([])
    property var uiSettings: ({ theme: "dark", refresh_seconds: 5,
                                 fronius_address: "", mt175_address: "",
                                 fronius_editable: true })

    Connections {
        target: bridge
        function onNowDataChanged()      { window.nowVm      = JSON.parse(bridge.nowData)      }
        function onTodayDataChanged()    { window.todayVm    = JSON.parse(bridge.todayData)    }
        function onDevicesDataChanged()  { window.devicesVm  = JSON.parse(bridge.devicesData)  }
        function onSettingsDataChanged() { window.uiSettings = JSON.parse(bridge.settingsData) }
    }

    // ---------------------------------------------------------------- //
    // Hintergrund                                                       //
    // ---------------------------------------------------------------- //
    background: Rectangle { color: theme.bg }

    // ---------------------------------------------------------------- //
    // Haupt-Layout: Inhalt + TabBar                                     //
    // ---------------------------------------------------------------- //
    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // Header
        Rectangle {
            Layout.fillWidth: true
            height: 52
            color: "transparent"

            RowLayout {
                anchors {
                    left: parent.left;  leftMargin: theme.spacingL
                    right: parent.right; rightMargin: theme.spacingL
                    verticalCenter: parent.verticalCenter
                }
                spacing: theme.spacingS

                Text {
                    text: "☀"
                    font.pixelSize: 20
                    color: theme.accent
                }
                Text {
                    text: "EnergyRadar"
                    font.pixelSize: theme.fontSizeBody
                    font.weight: Font.SemiBold
                    font.family: theme.fontFamily
                    color: theme.text
                    Layout.fillWidth: true
                }

                // Frische-Indikator oben rechts
                Rectangle {
                    width: freshnessLabel.implicitWidth + 20
                    height: 26
                    radius: theme.radiusPill
                    color: {
                        var q = window.nowVm.data_quality || "no_source"
                        if (q === "live")        return theme.positive
                        if (q === "stale")       return theme.warning
                        if (q === "no_source")   return theme.surfaceHigh
                        return theme.negative
                    }
                    opacity: 0.18
                    visible: true
                }
                Text {
                    id: freshnessLabel
                    text: window.nowVm.freshness_label || "–"
                    font.pixelSize: theme.fontSizeSmall
                    font.family: theme.fontFamily
                    color: {
                        var q = window.nowVm.data_quality || "no_source"
                        if (q === "live")        return theme.positive
                        if (q === "stale")       return theme.warning
                        return theme.textMuted
                    }
                }
            }

            // Trennlinie
            Rectangle {
                anchors.bottom: parent.bottom
                width: parent.width
                height: 1
                color: theme.border
                opacity: 0.5
            }
        }

        // Bildschirmbereich
        StackLayout {
            id: stack
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: tabBar.currentIndex

            NowScreen    { id: nowScreen }
            TodayScreen  { id: todayScreen }
            DevicesScreen{ id: devicesScreen }
            SettingsScreen{ id: settingsScreen }
        }

        // Tab-Bar am unteren Rand
        Rectangle {
            Layout.fillWidth: true
            height: 60
            color: theme.surface

            // Obere Trennlinie
            Rectangle {
                anchors.top: parent.top
                width: parent.width
                height: 1
                color: theme.border
                opacity: 0.5
            }

            TabBar {
                id: tabBar
                anchors.fill: parent
                anchors.topMargin: 1
                background: Rectangle { color: "transparent" }

                Repeater {
                    model: [
                        { icon: "⚡", label: str.tabNow      },
                        { icon: "📅", label: str.tabToday    },
                        { icon: "🔌", label: str.tabDevices  },
                        { icon: "⚙",  label: str.tabSettings },
                    ]
                    TabButton {
                        required property var modelData
                        required property int index

                        background: Rectangle { color: "transparent" }
                        contentItem: ColumnLayout {
                            spacing: 2
                            anchors.centerIn: parent
                            Text {
                                Layout.alignment: Qt.AlignHCenter
                                text: modelData.icon
                                font.pixelSize: 18
                                color: tabBar.currentIndex === index
                                       ? theme.accent : theme.textMuted
                            }
                            Text {
                                Layout.alignment: Qt.AlignHCenter
                                text: modelData.label
                                font.pixelSize: theme.fontSizeLabel
                                font.family: theme.fontFamily
                                color: tabBar.currentIndex === index
                                       ? theme.accent : theme.textMuted
                            }
                        }
                    }
                }
            }
        }
    }
}
