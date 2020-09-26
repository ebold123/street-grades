import json
import argparse
import pandas
import os
from elevation import ElevationData


def main():
    parser = argparse.ArgumentParser(
        "Merges an OSM road network with elevation data to produce grade data."
    )
    parser.add_argument(
        "--edges_csv",
        help="Path to CSV file of edges, from osmnet. Must have from_lat, from_lng, to_lat, to_lng",
    )
    parser.add_argument(
        "--out_path",
        default="/tmp/grades",
        help="Path to output grade output files",
    )
    parser.add_argument("--latlng", nargs="*", help="lat", default=[])
    args = parser.parse_args()

    elevation_data = ElevationData(data_path="data")

    if args.latlng:
        lat = float(args.latlng[0])
        lng = float(args.latlng[1])

        print("{}, {}".format(lat, lng))
        print("{}".format(elevation_data.get_elevation(lat, lng)))

    elif args.edges_csv:
        print(f"Read CSV from {args.edges_csv}")
        edges = pandas.read_csv(args.edges_csv)

        from_elevation = []
        to_elevation = []
        grades = []
        grades2 = []
        for idx, row in edges.iterrows():
            from_elevation.append(
                elevation_data.get_elevation(row["from_lat"], row["from_lng"])
            )
            to_elevation.append(
                elevation_data.get_elevation(row["to_lat"], row["to_lng"])
            )

            grades.append(
                round(
                    100.0 * (to_elevation[-1] - from_elevation[-1]) / row["distance"], 2
                )
            )
            grades2.append(min(7, abs(int(grades[-1] / 5))))

            if idx % 100 == 0:
                print(idx)

        edges["from_elevation"] = from_elevation
        edges["to_elevation"] = to_elevation
        edges["grade"] = grades
        edges["grade_category"] = grades2

        just_hills = edges[abs(edges["grade"]) > 2.0]

        os.makedirs(args.out_path, exist_ok=True)

        write_grades_to = os.path.join(args.out_path, "grades.csv")
        edges.to_csv(write_grades_to)
        print(f"Writing grades to {write_grades_to}")

        write_hill_grades_to = os.path.join(args.out_path, "grades_just_hills.csv")
        just_hills.to_csv(write_hill_grades_to)
        print(f"Writing hilly grades to {write_hill_grades_to}")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
