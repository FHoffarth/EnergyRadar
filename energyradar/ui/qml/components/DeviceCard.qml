import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

Rectangle {
    id: card

    property string deviceId: ""
    property string name: ""
    property string status: "unconfigured"
    property string lastSeen: ""
    property var available: []
    property var unavailable: []
    property string address: ""
    property bool hasError: false
    property string errorMessage: ""

    implicitHeight: layout.implicitHeight + theme.spacingM * 2
    radius: theme.radiusCard
    color: theme.surface
    border.color: theme.border
    border.width: 1

    ColumnLayout {
        id: layout
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: theme.spacingM
        spacing: theme.spacingS

        // Kopfzeile: Name & Status
        RowLayout {
            Layout.fillWidth: true
            spacing: theme.spacingS

            Text {
                text: card.name
                font.pixelSize: theme.fontSizeBody
                font.weight: Font.DemiBold
                font.family: theme.fontFamily
                color: theme.text
                Layout.fillWidth: true
            }

            Rectangle {
                width: statusText.implicitWidth + 16
                height: 24
                radius: 12
                color: {
                    if (card.status === "connected") return theme.positive
                    if (card.status === "error") return theme.negative
                    if (card.status === "unavailable") return theme.warning
                    return theme.neutral
                }
                opacity: 0.15
            }
            Text {
                id: statusText
                text: {
                    if (card.status === "connected") return str.statusConnected
                    if (card.status === "error") return str.statusError
                    if (card.status === "unavailable") return str.statusUnavailable
                    return str.statusUnconfigured
                }
                font.pixelSize: theme.fontSizeSmall
                font.family: theme.fontFamily
                color: {
                    if (card.status === "connected") return theme.positive
                    if (card.status === "error") return theme.negative
                    if (card.status === "unavailable") return theme.warning
                    return theme.textMuted
                }
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
            }
        }

        // Sub-Kopfzeile: Adresse & Zeit
        RowLayout {
            Layout.fillWidth: true
            Text {
                text: card.address
                font.pixelSize: theme.fontSizeSmall
                font.family: theme.fontFamily
                color: theme.textMuted
                visible: card.address !== ""
                Layout.fillWidth: true
            }
            Text {
                text: card.lastSeen
                font.pixelSize: theme.fontSizeSmall
                font.family: theme.fontFamily
                color: theme.textMuted
                Layout.alignment: Qt.AlignRight
            }
        }

        // Fehlerbereich
        Rectangle {
            Layout.fillWidth: true
            visible: card.hasError
            height: visible ? errorMsg.implicitHeight + 16 : 0
            color: theme.negative
            opacity: 0.1
            radius: theme.radiusInner
        }
        Text {
            id: errorMsg
            visible: card.hasError
            text: card.errorMessage
            font.pixelSize: theme.fontSizeSmall
            font.family: theme.fontFamily
            color: theme.negative
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            Layout.topMargin: card.hasError ? -height - 8 : 0
            leftPadding: 8
            rightPadding: 8
        }

        // Trenner
        Rectangle {
            Layout.fillWidth: true
            height: 1
            color: theme.border
            opacity: 0.5
            Layout.topMargin: theme.spacingXS
            Layout.bottomMargin: theme.spacingXS
        }

        // Datenpunkte (Verfügbar)
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2
            Repeater {
                model: card.available
                RowLayout {
                    Text { text: "✓"; color: theme.positive; font.pixelSize: theme.fontSizeSmall }
                    Text { text: modelData; color: theme.text; font.pixelSize: theme.fontSizeSmall; font.family: theme.fontFamily }
                }
            }
        }

        // Datenpunkte (Nicht verfügbar)
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2
            Repeater {
                model: card.unavailable
                RowLayout {
                    Text { text: "✗"; color: theme.negative; font.pixelSize: theme.fontSizeSmall }
                    Text { text: modelData; color: theme.textMuted; font.pixelSize: theme.fontSizeSmall; font.family: theme.fontFamily }
                }
            }
        }
    }
}
