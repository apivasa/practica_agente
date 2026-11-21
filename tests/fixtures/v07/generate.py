# QA V-07: genera los fixtures .xlsx con productores reales (XlsxWriter y
# LibreOffice), no con el lector bajo prueba. Datos ficticios.
# Uso (offline): python3 -I tests/fixtures/v07/generate.py
# Requiere xlsxwriter y, para avail-libreoffice.xlsx, soffice en el PATH.
import datetime as dt
import os
import shutil
import subprocess
import sys
import tempfile

import xlsxwriter

HERE = os.path.dirname(os.path.abspath(__file__))
D = dt.date


def out(name):
    return os.path.join(HERE, name)


AVAIL_CSV = (
    'fecha,unidad,valor\n'
    '2026-01-05,Unidad Alfa,99.95\n'
    '2026-01-06,Unidad Beta,99.5\n'
    '2026-01-07,unidad alfa,100\n'
    '2026-01-08,Unidad Beta,98.7\n'
)


def avail(name, date1904=False, with_time=False):
    wb = xlsxwriter.Workbook(out(name), {'date_1904': date1904})
    ws = wb.add_worksheet('Mediciones')
    bold = wb.add_format({'bold': True})
    red = wb.add_format({'font_color': 'red'})
    datef = wb.add_format({'num_format': 'yyyy-mm-dd hh:mm' if with_time else 'dd/mm/yyyy'})
    ws.write_string(0, 0, 'Fecha', bold)  # cabecera con mayúscula: se normaliza igual que en el CSV
    ws.write_string(0, 1, 'unidad', bold)
    ws.write_string(0, 2, 'valor', bold)
    times = [dt.time(23, 59, 59), dt.time(0, 0, 1), dt.time(12, 0), None]
    data = [(D(2026, 1, 5), 'Unidad Alfa', 99.95), (D(2026, 1, 6), 'Unidad Beta', 99.5),
            (D(2026, 1, 7), 'unidad alfa', 100), ('2026-01-08', 'Unidad Beta', 98.7)]
    for i, (f, u, v) in enumerate(data, start=1):
        if isinstance(f, str):
            ws.write_string(i, 0, f)  # fecha como texto AAAA-MM-DD
        else:
            value = dt.datetime.combine(f, times[i - 1]) if with_time else f
            ws.write_datetime(i, 0, value, datef)
        if i == 1:
            # rich text: "Unidad " en negrita + "Alfa" en rojo (varios <r> en sharedStrings)
            ws.write_rich_string(i, 1, bold, 'Unidad ', red, 'Alfa')
        else:
            ws.write_string(i, 1, u)
        ws.write_number(i, 2, v)
    # Segunda hoja con basura: solo se lee la primera.
    other = wb.add_worksheet('Notas')
    other.write_string(0, 0, 'columna_que_no_existe')
    wb.close()


def obs():
    wb = xlsxwriter.Workbook(out('obs.xlsx'))
    ws = wb.add_worksheet()
    for c, h in enumerate(['fecha', 'unidad', 'app_id', 'cumple']):
        ws.write_string(0, c, h)
    datef = wb.add_format({'num_format': 'yyyy-mm-dd'})
    rows = [(D(2026, 1, 12), 'Unidad Alfa', 'app-01', True), (D(2026, 1, 12), 'Unidad Beta', 'app-02', False),
            (D(2026, 1, 13), 'Unidad Alfa', 'app-03', 'sí')]
    for r, (f, u, a, ok) in enumerate(rows, start=1):
        ws.write_datetime(r, 0, f, datef)
        ws.write_string(r, 1, u)
        ws.write_string(r, 2, a)
        if isinstance(ok, bool):
            ws.write_boolean(r, 3, ok)
        else:
            ws.write_string(r, 3, ok)
    wb.close()
    with open(out('obs.csv'), 'w', encoding='utf-8') as fh:
        fh.write('fecha,unidad,app_id,cumple\n2026-01-12,Unidad Alfa,app-01,sí\n'
                 '2026-01-12,Unidad Beta,app-02,no\n2026-01-13,Unidad Alfa,app-03,sí\n')


def vuln():
    wb = xlsxwriter.Workbook(out('vuln.xlsx'))
    ws = wb.add_worksheet()
    for c, h in enumerate(['fecha', 'unidad', 'valor', 'categoria', 'tipo']):
        ws.write_string(0, c, h)
    datef = wb.add_format({'num_format': 'yyyy-mm-dd'})
    rows = [(D(2026, 1, 20), 'Unidad Gamma', 12, 'P0P1', 'resuelta'), (D(2026, 1, 20), 'Unidad Gamma', 30, 'P2P3', 'detectada'),
            (D(2026, 1, 21), 'Unidad Beta', 0, 'p0p1', None)]
    for r, (f, u, v, c, t) in enumerate(rows, start=1):
        ws.write_datetime(r, 0, f, datef)
        ws.write_string(r, 1, u)
        ws.write_number(r, 2, v)
        ws.write_string(r, 3, c)
        if t:
            ws.write_string(r, 4, t)
    wb.close()
    with open(out('vuln.csv'), 'w', encoding='utf-8') as fh:
        fh.write('fecha,unidad,valor,categoria,tipo\n2026-01-20,Unidad Gamma,12,P0P1,resuelta\n'
                 '2026-01-20,Unidad Gamma,30,P2P3,detectada\n2026-01-21,Unidad Beta,0,p0p1,\n')


def formula():
    wb = xlsxwriter.Workbook(out('avail-formula.xlsx'))
    ws = wb.add_worksheet()
    for c, h in enumerate(['fecha', 'unidad', 'valor']):
        ws.write_string(0, c, h)
    ws.write_string(1, 0, '2026-01-05')
    ws.write_string(1, 1, 'Unidad Alfa')
    ws.write_number(1, 2, 99.9)
    ws.write_string(2, 0, '2026-01-06')
    ws.write_string(2, 1, 'Unidad Beta')
    ws.write_formula(2, 2, '=C2+0.05', None, 99.95)  # valor calculado guardado: aun así se rechaza
    wb.close()


def wrong_columns():
    wb = xlsxwriter.Workbook(out('avail-columnas.xlsx'))
    ws = wb.add_worksheet()
    for c, h in enumerate(['fecha', 'unidad', 'valr', 'comentario']):
        ws.write_string(0, c, h)
    ws.write_string(1, 0, '2026-01-05')
    ws.write_string(1, 1, 'Unidad Alfa')
    ws.write_number(1, 2, 99.9)
    ws.write_string(1, 3, 'x')
    wb.close()
    with open(out('avail-columnas.csv'), 'w', encoding='utf-8') as fh:
        fh.write('fecha,unidad,valr,comentario\n2026-01-05,Unidad Alfa,99.9,x\n')


def libreoffice():
    soffice = shutil.which('soffice') or shutil.which('libreoffice')
    if not soffice:
        print('soffice no disponible: no se regenera avail-libreoffice.xlsx', file=sys.stderr)
        return
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, 'avail-libreoffice.csv')
        with open(src, 'w', encoding='utf-8') as fh:
            fh.write(AVAIL_CSV)
        subprocess.run([soffice, '--headless', '-env:UserInstallation=file://' + tmp + '/profile',
                        '--convert-to', 'xlsx', '--outdir', tmp, src], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.copy(os.path.join(tmp, 'avail-libreoffice.xlsx'), out('avail-libreoffice.xlsx'))


if __name__ == '__main__':
    with open(out('avail.csv'), 'w', encoding='utf-8') as fh:
        fh.write(AVAIL_CSV)
    avail('avail.xlsx')
    avail('avail-1904.xlsx', date1904=True)
    avail('avail-hora.xlsx', with_time=True)
    obs()
    vuln()
    formula()
    wrong_columns()
    libreoffice()
