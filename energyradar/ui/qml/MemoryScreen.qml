import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 20
        spacing: 20

        Text {
            text: "Gedächtnis & Backups"
            font.pixelSize: 24
            font.bold: true
            color: bridge.settings.theme === "dark" ? "#ffffff" : "#000000"
        }

        GridLayout {
            columns: 2
            rowSpacing: 10
            columnSpacing: 20

            Text { text: "Letztes Backup:"; color: bridge.settings.theme === "dark" ? "#cccccc" : "#333333" }
            Text { text: bridge.memory.last_backup_at !== "" ? bridge.memory.last_backup_at : "Nie"; color: bridge.settings.theme === "dark" ? "#ffffff" : "#000000" }

            Text { text: "Letzter Export:"; color: bridge.settings.theme === "dark" ? "#cccccc" : "#333333" }
            Text { text: bridge.memory.last_export_at !== "" ? bridge.memory.last_export_at : "Nie"; color: bridge.settings.theme === "dark" ? "#ffffff" : "#000000" }
        }

        RowLayout {
            spacing: 10
            Button {
                text: "Backup erstellen"
                onClicked: {
                    var path = "storage_backup.zip"
                    bridge.createBackup(path)
                }
            }
            Button {
                text: "Exportieren (CSV)"
                onClicked: {
                    var path = "export.csv"
                    bridge.exportData(path, "csv", "2000-01-01", "2099-12-31")
                }
            }
        }

        Item { Layout.fillHeight: true }
    }
}
