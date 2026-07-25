import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

Rectangle {
    id: card

    property string label: ""
    property string value: "–"
    property string unit: ""
    property bool available: false
    property string iconText: ""
    property color valueColor: theme.text

    implicitHeight: 100
    radius: theme.radiusCard
    color: theme.surface
    border.color: theme.border
    border.width: 1

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: theme.spacingM
        spacing: theme.spacingXS

        // Label + Icon
        RowLayout {
            Layout.fillWidth: true
            spacing: 4
            Text {
                text: card.iconText
                font.pixelSize: theme.fontSizeSmall
                color: theme.textMuted
                visible: card.iconText !== ""
            }
            Text {
                text: card.label
                font.pixelSize: theme.fontSizeLabel
                font.family: theme.fontFamily
                color: theme.textMuted
                Layout.fillWidth: true
                elide: Text.ElideRight
            }
        }

        // Wert + Einheit
        RowLayout {
            Layout.fillWidth: true
            spacing: 4
            Text {
                text: card.value
                font.pixelSize: theme.fontSizeValue
                font.weight: Font.DemiBold
                font.family: theme.fontFamily
                color: card.valueColor
                Layout.alignment: Qt.AlignBaseline
            }
            Text {
                text: card.unit
                font.pixelSize: theme.fontSizeBody
                font.family: theme.fontFamily
                color: theme.textMuted
                visible: card.unit !== ""
                Layout.alignment: Qt.AlignBaseline
            }
        }
    }
}
