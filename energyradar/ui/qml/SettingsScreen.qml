import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

Item {
    id: root
    property var vm: window.uiSettings

    // Lokaler State für das Formular, damit es nicht sofort springt wenn getippt wird
    property string localFroniusAddress: vm.fronius_address || ""
    property string localMt175Address: vm.mt175_address || ""
    property int localRefresh: vm.refresh_seconds || 5
    property string localTheme: vm.theme || "dark"

    // Bei Änderungen vom Bridge den lokalen State nachziehen
    Connections {
        target: window
        function onUiSettingsChanged() {
            localFroniusAddress = vm.fronius_address || ""
            localMt175Address = vm.mt175_address || ""
            localRefresh = vm.refresh_seconds || 5
            localTheme = vm.theme || "dark"
            
            froniusTestResult.text = ""
            mt175TestResult.text = ""
        }
    }
    
    Connections {
        target: bridge
        function onConnectionTestResult(deviceId, resultJson) {
            var res = JSON.parse(resultJson)
            var targetLabel = deviceId === "fronius" ? froniusTestResult : mt175TestResult
            targetLabel.text = res.message
            targetLabel.color = res.ok ? theme.positive : theme.negative
        }
    }

    ScrollView {
        anchors.fill: parent
        contentWidth: parent.width
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

        ColumnLayout {
            width: Math.min(parent.parent.width, 560)
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: theme.spacingL

            Text {
                text: str.settingsTitle
                font.pixelSize: theme.fontSizeValue
                font.weight: Font.DemiBold
                font.family: theme.fontFamily
                color: theme.text
                Layout.fillWidth: true
            }

            // -------------------------------------------------------- //
            // GERÄTE                                                    //
            // -------------------------------------------------------- //
            Text {
                text: str.settingsSectionDevices
                font.pixelSize: theme.fontSizeBody
                font.weight: Font.DemiBold
                font.family: theme.fontFamily
                color: theme.textMuted
                Layout.topMargin: theme.spacingS
            }

            // Fronius
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: froniusCol.implicitHeight + theme.spacingM * 2
                radius: theme.radiusCard
                color: theme.surface
                border.color: theme.border
                border.width: 1

                ColumnLayout {
                    id: froniusCol
                    anchors.fill: parent
                    anchors.margins: theme.spacingM
                    spacing: theme.spacingS

                    Text { text: str.settingsFroniusLabel; color: theme.text; font.family: theme.fontFamily; font.pixelSize: theme.fontSizeBody }
                    
                    TextField {
                        id: froniusInput
                        Layout.fillWidth: true
                        text: localFroniusAddress
                        onTextChanged: localFroniusAddress = text
                        placeholderText: str.settingsFroniusHint
                        enabled: vm.fronius_editable || false
                        color: theme.text
                        background: Rectangle {
                            color: theme.surfaceHigh
                            border.color: froniusInput.activeFocus ? theme.accent : theme.border
                            radius: theme.radiusInner
                        }
                        padding: 10
                    }
                    
                    RowLayout {
                        Button {
                            text: str.settingsTest
                            onClicked: bridge.testConnection("fronius", localFroniusAddress)
                        }
                        Text {
                            id: froniusTestResult
                            Layout.fillWidth: true
                            font.pixelSize: theme.fontSizeSmall
                            font.family: theme.fontFamily
                        }
                    }
                }
            }

            // MT175
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: mt175Col.implicitHeight + theme.spacingM * 2
                radius: theme.radiusCard
                color: theme.surface
                border.color: theme.border
                border.width: 1

                ColumnLayout {
                    id: mt175Col
                    anchors.fill: parent
                    anchors.margins: theme.spacingM
                    spacing: theme.spacingS

                    Text { text: str.settingsMt175Label; color: theme.text; font.family: theme.fontFamily; font.pixelSize: theme.fontSizeBody }
                    
                    TextField {
                        id: mt175Input
                        Layout.fillWidth: true
                        text: localMt175Address
                        onTextChanged: localMt175Address = text
                        placeholderText: str.settingsMt175Hint
                        color: theme.text
                        background: Rectangle {
                            color: theme.surfaceHigh
                            border.color: mt175Input.activeFocus ? theme.accent : theme.border
                            radius: theme.radiusInner
                        }
                        padding: 10
                    }
                    
                    RowLayout {
                        Button {
                            text: str.settingsTest
                            onClicked: bridge.testConnection("mt175", localMt175Address)
                        }
                        Text {
                            id: mt175TestResult
                            Layout.fillWidth: true
                            font.pixelSize: theme.fontSizeSmall
                            font.family: theme.fontFamily
                        }
                    }
                }
            }

            // -------------------------------------------------------- //
            // DATEN & DARSTELLUNG                                       //
            // -------------------------------------------------------- //
            Text {
                text: str.settingsSectionData + " & " + str.settingsSectionDisplay
                font.pixelSize: theme.fontSizeBody
                font.weight: Font.DemiBold
                font.family: theme.fontFamily
                color: theme.textMuted
                Layout.topMargin: theme.spacingS
            }

            Rectangle {
                Layout.fillWidth: true
                implicitHeight: generalCol.implicitHeight + theme.spacingM * 2
                radius: theme.radiusCard
                color: theme.surface
                border.color: theme.border
                border.width: 1

                ColumnLayout {
                    id: generalCol
                    anchors.fill: parent
                    anchors.margins: theme.spacingM
                    spacing: theme.spacingM

                    // Refresh
                    ColumnLayout {
                        spacing: 4
                        Layout.fillWidth: true
                        Text { text: str.settingsRefresh + ": " + localRefresh + " " + str.settingsSeconds; color: theme.text; font.family: theme.fontFamily; font.pixelSize: theme.fontSizeBody }
                        Slider {
                            Layout.fillWidth: true
                            from: 3
                            to: 60
                            stepSize: 1
                            value: localRefresh
                            onValueChanged: localRefresh = value
                        }
                    }

                    // Theme
                    ColumnLayout {
                        spacing: 4
                        Layout.fillWidth: true
                        Text { text: str.settingsTheme; color: theme.text; font.family: theme.fontFamily; font.pixelSize: theme.fontSizeBody }
                        RowLayout {
                            RadioButton { text: str.settingsThemeDark; checked: localTheme === "dark"; onClicked: localTheme = "dark" }
                            RadioButton { text: str.settingsThemeLight; checked: localTheme === "light"; onClicked: localTheme = "light" }
                            RadioButton { text: str.settingsThemeSystem; checked: localTheme === "system"; onClicked: localTheme = "system" }
                        }
                    }
                }
            }

            // Speichern-Button
            Button {
                Layout.alignment: Qt.AlignRight
                text: str.settingsSave
                font.weight: Font.DemiBold
                onClicked: {
                    var payload = {
                        refresh_seconds: localRefresh,
                        theme: localTheme,
                        mt175_address: localMt175Address
                    }
                    bridge.saveSettings(JSON.stringify(payload))
                    
                    if (vm.fronius_editable && localFroniusAddress !== (vm.fronius_address || "")) {
                        bridge.saveFroniusAddress(localFroniusAddress)
                    }
                }
            }

            Item { height: theme.spacingL }
        }
    }
}
