import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "components"

Item {
    id: root
    property var devicesVm: window.devicesVm || []

    ScrollView {
        anchors.fill: parent
        contentWidth: parent.width
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

        ColumnLayout {
            width: Math.min(parent.parent.width, 560)
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: theme.spacingL

            Text {
                text: str.devicesTitle
                font.pixelSize: theme.fontSizeValue
                font.weight: Font.DemiBold
                font.family: theme.fontFamily
                color: theme.text
                Layout.fillWidth: true
            }

            Repeater {
                model: devicesVm
                DeviceCard {
                    Layout.fillWidth: true
                    deviceId: modelData.device_id || ""
                    name: modelData.name || ""
                    status: modelData.status || ""
                    lastSeen: modelData.last_seen_label || ""
                    available: modelData.available_measurements || []
                    unavailable: modelData.unavailable_measurements || []
                    address: modelData.address || ""
                    hasError: modelData.has_error || false
                    errorMessage: modelData.error_message || ""
                }
            }

            Item { height: theme.spacingL }
        }
    }
}
