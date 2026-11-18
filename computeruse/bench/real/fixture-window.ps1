# A disposable window for running the real Windows driver against, and nothing else. It shows without taking focus,
# writes only inside the folder it is given, and closes itself after ten minutes.
param([Parameter(Mandatory = $true)][string]$Out)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System.Windows.Forms;
public class QuietForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
}
'@

$title = "DaniBot driver fixture (safe to close)"
$form = New-Object QuietForm
$form.Text = $title
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point(40, 40)
$form.Size = New-Object System.Drawing.Size(380, 300)
$form.TopMost = $false

function Add-Control($control, $name, $x, $y, $w, $h) {
  $control.Name = $name
  $control.AccessibleName = $name
  $control.Location = New-Object System.Drawing.Point($x, $y)
  $control.Size = New-Object System.Drawing.Size($w, $h)
  $form.Controls.Add($control)
  return $control
}

$body = Add-Control (New-Object System.Windows.Forms.TextBox) "Body" 20 20 320 24
$secret = Add-Control (New-Object System.Windows.Forms.TextBox) "Card number" 20 56 320 24
$secret.UseSystemPasswordChar = $true
$secret.Text = "4111111111111111"
$save = Add-Control (New-Object System.Windows.Forms.Button) "Save" 20 100 100 32
$save.Text = "Save"
$mark = Add-Control (New-Object System.Windows.Forms.Button) "Mark" 130 100 100 32
$mark.Text = "Mark"
$send = Add-Control (New-Object System.Windows.Forms.Button) "Send" 240 100 100 32
$send.Text = "Send"

$quit = Add-Control (New-Object System.Windows.Forms.Button) "Quit" 20 190 100 32
$quit.Text = "Quit"
$banner = Add-Control (New-Object System.Windows.Forms.Label) "Banner" 20 150 330 30
$banner.Text = "Automated test: please do not use the mouse or keyboard for a few seconds."
$banner.ForeColor = [System.Drawing.Color]::DarkRed
$saved = 0
$save.Add_Click({ $script:saved += 1; Set-Content -LiteralPath (Join-Path $Out "saved.txt") -Value $body.Text -NoNewline; Set-Content -LiteralPath (Join-Path $Out "saved.count") -Value $script:saved })
$mark.Add_Click({ if ($mark.Text -eq "Mark") { $mark.Text = "Marked" } else { $mark.Text = "Mark" }; $mark.AccessibleName = $mark.Text })
$send.Add_Click({ Set-Content -LiteralPath (Join-Path $Out "sent.txt") -Value "sent" })
$quit.Add_Click({ $form.Close() })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 600000
$timer.Add_Tick({ $form.Close() })
$timer.Start()

$form.Add_Shown({
  $info = @{ pid = $PID; title = $title } | ConvertTo-Json -Compress
  Set-Content -LiteralPath (Join-Path $Out "ready.json") -Value $info -NoNewline
})
[System.Windows.Forms.Application]::Run($form)
