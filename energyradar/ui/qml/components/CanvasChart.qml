import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

Rectangle {
    id: chart

    property var history: []
    property color lineColor: theme.accent
    property color gridColor: theme.border
    property string emptyText: "Keine Daten"

    implicitHeight: 200
    color: "transparent"

    Canvas {
        id: canvas
        anchors.fill: parent
        onPaint: {
            var ctx = getContext("2d")
            ctx.clearRect(0, 0, width, height)

            if (!history || history.length === 0) {
                return
            }

            var maxPower = 0
            for (var i = 0; i < history.length; i++) {
                if (history[i].powerW > maxPower) maxPower = history[i].powerW
            }
            
            // At least show some scale
            if (maxPower < 100) maxPower = 100
            
            // Add padding to max
            maxPower *= 1.1

            // Draw horizontal grid lines
            ctx.beginPath()
            ctx.strokeStyle = gridColor
            ctx.lineWidth = 1
            ctx.setLineDash([4, 4])
            var steps = 4
            for (var j = 0; j <= steps; j++) {
                var yGrid = height - (j / steps) * height
                ctx.moveTo(0, yGrid)
                ctx.lineTo(width, yGrid)
            }
            ctx.stroke()
            ctx.setLineDash([])

            // Draw data
            ctx.beginPath()
            ctx.strokeStyle = lineColor
            ctx.lineWidth = 3
            ctx.lineJoin = "round"
            
            var xStep = width / Math.max(1, history.length - 1)
            
            for (var k = 0; k < history.length; k++) {
                var pt = history[k]
                var px = k * xStep
                var py = height - (Math.max(0, pt.powerW) / maxPower) * height
                
                if (k === 0) {
                    ctx.moveTo(px, py)
                } else {
                    ctx.lineTo(px, py)
                }
            }
            ctx.stroke()

            // Fill area under curve
            ctx.beginPath()
            ctx.fillStyle = lineColor
            ctx.globalAlpha = 0.1
            for (var l = 0; l < history.length; l++) {
                var pt2 = history[l]
                var px2 = l * xStep
                var py2 = height - (Math.max(0, pt2.powerW) / maxPower) * height
                
                if (l === 0) {
                    ctx.moveTo(px2, height)
                    ctx.lineTo(px2, py2)
                } else {
                    ctx.lineTo(px2, py2)
                }
            }
            ctx.lineTo(width, height)
            ctx.lineTo(0, height)
            ctx.fill()
            ctx.globalAlpha = 1.0
        }

        Connections {
            target: chart
            function onHistoryChanged() {
                canvas.requestPaint()
            }
        }
        
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
    }

    Text {
        anchors.centerIn: parent
        visible: !chart.history || chart.history.length === 0
        text: chart.emptyText
        font.pixelSize: theme.fontSizeBody
        font.family: theme.fontFamily
        color: theme.textMuted
    }
}
