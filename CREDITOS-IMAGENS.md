# Créditos das imagens de demonstração

As fotos em `uploads/` foram **baixadas da Wikimedia Commons** e não são armazenadas no GitHub
(a pasta `uploads/` está no `.gitignore`). Elas ilustram os produtos de demonstração criados por `npm run seed`.

| Arquivo em `uploads/` | Foto original | Autor | Licença |
| --- | --- | --- | --- |
| `placa-video.jpg` | [MSI GeForce RTX 3070 VENTUS 3X OC](https://commons.wikimedia.org/wiki/File:MSI_GeForce_RTX_3070_VENTUS_3X_OC.jpg) | TheStriker | CC BY 4.0 |
| `processador.jpg` | [AMD Ryzen 5 2600](https://commons.wikimedia.org/wiki/File:AMD_Ryzen_5_2600_(39851733273).jpg) | Fritzchens Fritz | CC0 |
| `memoria.jpg` | [Ramaxel 16 GB DDR5-5600](https://commons.wikimedia.org/wiki/File:Ramaxel_16_GB_DDR5-5600_SO-DIMM_memory_module.jpg) | ITEagle Europe – Sebastiaan Broekhoven | CC BY-SA 4.0 |
| `teclado.jpg` | [Mechanical Keyboard](https://commons.wikimedia.org/wiki/File:Mechanical_Keyboard.jpg) | SolarMainframe | CC BY-SA 4.0 |
| `mouse.jpg` | [Logitech G903 Lightspeed](https://commons.wikimedia.org/wiki/File:2023_Mysz_komputerowa_Logitech_G903_Lightspeed.jpg) | Jacek Halicki | CC BY-SA 4.0 |
| `monitor.jpg` | [ASUS PB278Q](https://commons.wikimedia.org/wiki/File:ASUS_PB278Q_(PXL_20250914_223256075).jpg) | Hayden Schiff | CC BY 4.0 |
| `fonte.jpg` | [Full modular ATX power supply unit](https://commons.wikimedia.org/wiki/File:Full_modular_ATX_power_supply_unit.jpg) | Project Kei | CC BY-SA 4.0 |
| `ssd.jpg` | [Samsung 980 PRO 1TB](https://commons.wikimedia.org/wiki/File:Samsung_980_PRO_PCIe_4.0_NVMe_SSD_1TB-top_PNr%C2%B00915.jpg) | D-Kuru | CC BY-SA 4.0 |

> As fotos são ilustrativas: alguns modelos photographados diferem do nome comercial do produto de demonstração.

Para adicionar outras imagens, use o campo de upload em **Minha loja → Adicionar produto** ou a rota
`POST /loja/produtos/:id/imagem`. Novos arquivos também ficam em `uploads/`.
