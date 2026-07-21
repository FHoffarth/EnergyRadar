import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import "components"

Item {
    id: root

    // Bequemer Zugriff auf Bridge-Daten über das Parent-Fenster
    property var vm: window.nowVm
    property bool pinLocked: vm.pin_locked || false

    // ---------------------------------------------------------------- //
    // Scrollbarer Hauptbereich                                          //
    // ---------------------------------------------------------------- //
    ScrollView {
        anchors.fill: parent
        contentWidth: parent.width
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

        ColumnLayout {
            width: Math.min(parent.parent.width, 560)
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: theme.spacingL

            // -------------------------------------------------------- //
            // 1. VERDIKT                                                //
            // -------------------------------------------------------- //
            Item {
                Layout.fillWidth: true
                implicitHeight: verdiktText.implicitHeight + theme.spacingM

                Text {
                    id: verdiktText
                    anchors {
                        left: parent.left
                        right: parent.right
                        verticalCenter: parent.verticalCenter
                    }
                    text: vm.verdict || "Verbindung wird hergestellt …"
                    font.pixelSize: theme.fontSizeVerdict
                    font.weight: Font.Bold
                    font.family: theme.fontFamily
                    wrapMode: Text.WordWrap
                    lineHeight: 1.25
                    color: {
                        var k = vm.verdict_kind || "connecting"
                        if (k === "importing")  return theme.negative
                        if (k === "exporting")  return theme.positive
                        if (k === "balanced")   return theme.positive
                        if (k === "no_source")  return theme.textMuted
                        return theme.text
                    }
                    Behavior on color { ColorAnimation { duration: 300 } }
                }
            }

            // -------------------------------------------------------- //
            // 2. PIN-LOCK-BANNER (nur wenn Zähler nicht entsperrt)     //
            // -------------------------------------------------------- //
            Rectangle {
                Layout.fillWidth: true
                visible: pinLocked
                height: visible ? pinLockText.implicitHeight + theme.spacingM * 2 : 0
                radius: theme.radiusCard
                color: theme.accentFaded
                border.color: theme.accent
                border.width: 1

                Text {
                    id: pinLockText
                    anchors {
                        left: parent.left; right: parent.right
                        verticalCenter: parent.verticalCenter
                        margins: theme.spacingM
                    }
                    text: str.pinLockBanner
                    font.pixelSize: theme.fontSizeSmall
                    font.family: theme.fontFamily
                    color: theme.accent
                    wrapMode: Text.WordWrap
                }
            }

            // -------------------------------------------------------- //
            // 3. MESSWERT-KARTEN                                        //
            // -------------------------------------------------------- //
            GridLayout {
                Layout.fillWidth: true
                columns: 3
                columnSpacing: theme.spacingS
                rowSpacing: theme.spacingS

                // PV
                ValueCard {
                    Layout.fillWidth: true
                    label:    str.labelPv
                    value:    vm.pv_label    || str.labelUnknown
                    unit:     vm.pv_available ? "" : ""
                    available: vm.pv_available || false
                    iconText:  "☀"
                }

                // Verbrauch
                ValueCard {
                    Layout.fillWidth: true
                    label:     str.labelConsumption
                    value:     vm.consumption_label || str.labelUnknown
                    available: vm.consumption_available || false
                    iconText:  "🏠"
                }

                // Netz
                ValueCard {
                    Layout.fillWidth: true
                    label:     str.labelGrid
                    value:     vm.grid_label || str.labelUnknown
                    available: vm.grid_available || false
                    iconText:  "⚡"
                    valueColor: {
                        if (!vm.grid_available) return theme.textMuted
                        var w = vm.grid_power_w || 0
                        if (w > 5)  return theme.negative   // Bezug
                        if (w < -5) return theme.positive   // Einspeisung
                        return theme.text
                    }
                }
            }

            // -------------------------------------------------------- //
            // 4. FRISCHE-ZEILE                                          //
            // -------------------------------------------------------- //
            RowLayout {
                Layout.fillWidth: true
                spacing: theme.spacingS

                // Frische-Dot
                Rectangle {
                    width: 8; height: 8; radius: 4
                    color: {
                        var q = vm.data_quality || "no_source"
                        if (q === "live")    return theme.positive
                        if (q === "stale")   return theme.warning
                        if (q === "error")   return theme.negative
                        return theme.textDisabled
                    }
                    Behavior on color { ColorAnimation { duration: 400 } }
                }

                Text {
                    text: vm.freshness_label || str.labelUnknown
                    font.pixelSize: theme.fontSizeSmall
                    font.family: theme.fontFamily
                    color: theme.textMuted
                }

                Item { Layout.fillWidth: true }

                // CTA wenn keine Quelle
                Text {
                    visible: (vm.verdict_kind || "") === "no_source"
                    text: str.noSourceCta
                    font.pixelSize: theme.fontSizeSmall
                    font.family: theme.fontFamily
                    font.underline: true
                    color: theme.accent

                    MouseArea {
                        anchors.fill: parent
                        onClicked: tabBar.currentIndex = 3   // → Einstellungen
                        cursorShape: Qt.PointingHandCursor
                    }
                }
            }

            // Unten etwas Luft
            Item { height: theme.spacingL }
        }
    }
}
