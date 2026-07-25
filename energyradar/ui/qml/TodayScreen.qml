import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "components"

Item {
    id: root
    property var vm: window.todayVm

    ScrollView {
        anchors.fill: parent
        contentWidth: parent.width
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

        ColumnLayout {
            width: Math.min(parent.parent.width, 560)
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: theme.spacingL

            // -------------------------------------------------------- //
            // 1. KARTEN-GRID (2x2)                                     //
            // -------------------------------------------------------- //
            GridLayout {
                Layout.fillWidth: true
                columns: 2
                columnSpacing: theme.spacingS
                rowSpacing: theme.spacingS

                ValueCard {
                    Layout.fillWidth: true
                    label: str.todayGenerated
                    value: vm.generated_label || str.labelUnknown
                }
                ValueCard {
                    Layout.fillWidth: true
                    label: str.labelConsumption // TODO self consumption or total?
                    value: str.labelUnknown // TODO add self-consumption to viewmodel if needed
                    visible: false
                }
                ValueCard {
                    Layout.fillWidth: true
                    label: str.todayImport
                    value: vm.import_total_label || str.labelUnknown
                }
                ValueCard {
                    Layout.fillWidth: true
                    label: str.todayExport
                    value: vm.export_total_label || str.labelUnknown
                }
            }

            // -------------------------------------------------------- //
            // 2. CHART                                                  //
            // -------------------------------------------------------- //
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: 280
                radius: theme.radiusCard
                color: theme.surface
                border.color: theme.border
                border.width: 1

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: theme.spacingM
                    spacing: theme.spacingS

                    Text {
                        text: str.todayChartTitle
                        font.pixelSize: theme.fontSizeBody
                        font.weight: Font.DemiBold
                        font.family: theme.fontFamily
                        color: theme.text
                    }

                    CanvasChart {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        history: vm.history || []
                        emptyText: str.todayNoHistory
                    }
                }
            }

            // CTA wenn keine Quelle
            Text {
                visible: !(vm.has_source || false)
                Layout.alignment: Qt.AlignHCenter
                text: str.todayNoSource
                font.pixelSize: theme.fontSizeBody
                font.family: theme.fontFamily
                color: theme.textMuted
            }

            Item { height: theme.spacingL }
        }
    }
}
